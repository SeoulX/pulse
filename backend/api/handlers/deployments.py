import traceback
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request

from api.deps import require_admin
from core.config import settings
from models.deployment import DeploymentRequest
from models.user import User
from schemas.deployment import (
    CreateDeploymentRequest,
    PipelineCallback,
    RejectDeploymentRequest,
)
from services.bitbucket import (
    BOOTSTRAP_TAGS,
    add_webhook,
    classify_tags,
    delete_tag,
    list_tags,
    parse_repo_slug,
    push_tag,
)
from services.redis_specs import enqueue_job, publish_spec

router = APIRouter(prefix="/deployments", tags=["deployments"])

REGISTRY = "zen0hub"

_CLUSTER_TOLERATIONS = {
    "kl-1": [{"key": "proj", "operator": "Equal", "value": "salina", "effect": "NoSchedule"}],
    "kl-2": [{"key": "dept", "operator": "Equal", "value": "dc", "effect": "NoSchedule"}],
    "net3": [],
}


def _host_aliases_for(cluster: str) -> list[dict]:
    """Mongo + arbiter hostAliases per cluster network.
    kl-1 / kl-2 share the 192.168.10.0/24 network; net3 is on 192.168.11.0/24.
    Mongo replica set members live at .10–.13, arbiter at .33."""
    if cluster in ("kl-1", "kl-2"):
        net = "10"
    elif cluster == "net3":
        net = "11"
    else:
        return []
    return [
        {"ip": f"192.168.{net}.10", "hostnames": ["mongodb1"]},
        {"ip": f"192.168.{net}.11", "hostnames": ["mongodb2"]},
        {"ip": f"192.168.{net}.12", "hostnames": ["mongodb3"]},
        {"ip": f"192.168.{net}.13", "hostnames": ["mongodb4"]},
        {"ip": f"192.168.{net}.33", "hostnames": ["arbiter"]},
    ]


# Role → default container args. Empty string = let the image's CMD run as-is.
# Streamlit is the only role where the image's CMD is rarely the right thing —
# most python base images CMD into a shell, so we always pass `streamlit run …`.
_ROLE_DEFAULT_ARGS: dict[str, dict[str, str]] = {
    "Streamlit": {
        "server": "run\nstreamlit_app.py\n--server.port=8501\n--server.address=0.0.0.0\n--server.headless=true"
    },
}


def _derive_profile(team: str, role: str | None, kind: str) -> str | None:
    """Map (team, role, kind) → generate-manifests.sh profile.
    Profile only meaningful for Deployment kind; other kinds keep the legacy path."""
    if kind != "Deployment":
        return None
    if team == "Frontend" or role == "UI":
        return "ui"
    if role == "API+Worker":
        return "api-worker"
    if role == "Worker":
        return "worker"
    if role == "Streamlit":
        # Streamlit shares the api shape (envFrom + svc + ingress) but binds to
        # 8501 and runs `streamlit run`. Keep "api" until the script grows a
        # streamlit branch; port + command can be patched manually for now.
        return "api"
    if role == "Multi-Worker":
        # Multi-worker apps ship a devops/workers.yaml in the repo. The bootstrap
        # script reads it and scaffolds N children (server + streamlit + workers).
        return "multi-worker"
    return "api"


def _build_jenkins_spec(d: DeploymentRequest) -> dict:
    """Construct the spec.json content Jenkins will read from Redis."""
    image = f"{REGISTRY}/{d.repo_slug}"
    app = d.repo_slug.replace("_", "-")
    profile = _derive_profile(d.team, d.role, d.workload_kind)
    spec: dict = {
        "app": app,
        "cluster": d.cluster,
        "image": image,
        "workloadKind": d.workload_kind,
        "port": d.port,
        "environments": d.environments,
        "env_vars": d.env_vars or {},
        "tolerations": _CLUSTER_TOLERATIONS.get(d.cluster, []),
        "hostAliases": _host_aliases_for(d.cluster),
    }
    if profile:
        spec["profile"] = profile
    if d.domain:
        spec["domain"] = d.domain
    # Container args precedence: explicit override (rare; admin/API only) wins,
    # else fall back to the role's default. Form doesn't surface args anymore.
    args = dict(_ROLE_DEFAULT_ARGS.get(d.role or "", {}))
    if d.args:
        for k, v in d.args.items():
            if v and v.strip():
                args[k] = v
    if args:
        spec["args"] = args
    if profile in ("api", "api-worker"):
        # Per-env HPA defaults — form doesn't surface these, devs get sensible
        # values automatically. Staging stays small (1–3); production scales
        # higher (1–5). Both target 80% CPU. Override via `hpa` field if needed.
        autoscaler = {
            "type": "HPA",
            "staging":    {"min": 1, "max": 3, "target_cpu": 80},
            "production": {"min": 1, "max": 5, "target_cpu": 80},
        }
        # Allow API-level override: hpa = {"staging": {...}, "production": {...}}.
        for env_name, override in (d.hpa or {}).items():
            if isinstance(override, dict) and env_name in autoscaler:
                autoscaler[env_name].update(override)
        spec["autoscaler"] = autoscaler
    if profile == "api-worker":
        spec["images"] = {
            "server": f"{image}-server",
            "worker": f"{image}-worker",
        }
    return spec


def _manifest_path(d: DeploymentRequest) -> str:
    if d.team in ("DC", "ML"):
        return f"{d.cluster}/data-collection/{d.repo_slug}/"
    return f"{d.cluster}/{d.repo_slug}/"


def serialize(d: DeploymentRequest) -> dict:
    return {
        "_id": str(d.id),
        "repoSlug": d.repo_slug,
        "repoUrl": d.repo_url,
        "team": d.team,
        "workloadKind": d.workload_kind,
        "role": d.role,
        "cluster": d.cluster,
        "environments": d.environments,
        "envVars": d.env_vars,
        "domain": d.domain,
        "port": d.port,
        "args": d.args,
        "hpa": d.hpa,
        "manifestPath": _manifest_path(d),
        "status": d.status,
        "error": d.error,
        "requestedBy": d.requested_by,
        "approvedBy": d.approved_by,
        "approvedAt": d.approved_at.isoformat() if d.approved_at else None,
        "rejectionReason": d.rejection_reason,
        "trackToken": d.track_token,
        "trackUrl": f"/deploy/track/{d.track_token}",
        "createdAt": d.created_at.isoformat(),
    }


def serialize_public(d: DeploymentRequest) -> dict:
    """Public-safe view. No requester email, no _id."""
    return {
        "repoSlug": d.repo_slug,
        "team": d.team,
        "workloadKind": d.workload_kind,
        "role": d.role,
        "cluster": d.cluster,
        "environments": d.environments,
        "envVars": d.env_vars,
        "domain": d.domain,
        "port": d.port,
        "args": d.args,
        "hpa": d.hpa,
        "manifestPath": _manifest_path(d),
        "status": d.status,
        "error": d.error,
        "rejectionReason": d.rejection_reason,
        "approvedAt": d.approved_at.isoformat() if d.approved_at else None,
        "trackToken": d.track_token,
        "createdAt": d.created_at.isoformat(),
    }


async def _build_planned(dep: DeploymentRequest) -> dict:
    """Compute the Jenkins dispatch plan (tag actions, webhook, etc.)."""
    existing_tags = await list_tags(dep.repo_slug)
    tag_class = classify_tags(existing_tags)

    env_tag_map = {"staging": "v0.0.0-alpha", "production": "v0.0.0"}
    planned_tag_names = [env_tag_map[e] for e in dep.environments]
    conflicted = set(tag_class["bootstrap"]) & set(planned_tag_names)

    tag_actions: list[dict] = []
    for tag in planned_tag_names:
        if tag in conflicted:
            tag_actions.append(
                {"action": "delete_tag", "name": tag, "reason": "bootstrap tag already exists"}
            )
        tag_actions.append({"action": "push_tag", "name": tag})

    return {
        "repo_slug": dep.repo_slug,
        "repo_url": dep.repo_url,
        "team": dep.team,
        "workload_kind": dep.workload_kind,
        "role": dep.role,
        "cluster": dep.cluster,
        "environments": dep.environments,
        "env_vars": dep.env_vars,
        "domain": dep.domain,
        "port": dep.port,
        "args": dep.args,
        "hpa": dep.hpa,
        "manifest_path": _manifest_path(dep),
        "existing_tags": existing_tags,
        "conflict_strategy": "delete_and_repush" if conflicted else None,
        "webhook": {"action": "add_webhook", "url": "<JENKINS_WEBHOOK_URL>"},
        "tags": tag_actions,
        "requested_by": dep.requested_by,
        "approved_by": dep.approved_by,
        "track_token": dep.track_token,
    }


def _log_dry_run(planned: dict) -> None:
    print("=" * 60)
    print("[DEPLOYMENT DRY RUN] would dispatch to Jenkins:")
    for k, v in planned.items():
        print(f"  {k}: {v}")
    print("=" * 60, flush=True)


@router.get("")
async def list_deployments(admin: User = Depends(require_admin)):
    """Admin-only: monitor submitted deployment requests."""
    docs = await DeploymentRequest.find_all().sort("-createdAt").to_list()
    return [serialize(d) for d in docs]


@router.get("/track/{token}")
async def track_deployment(token: str):
    """Public: look up a deployment request by its opaque track token."""
    dep = await DeploymentRequest.find_one(DeploymentRequest.track_token == token)
    if not dep:
        raise HTTPException(status_code=404, detail="Tracking link not found")
    return serialize_public(dep)


# Statuses that don't yet have a finalized spec or are no longer dispatchable.
# Jenkins should never bootstrap from these — return 404.
_NO_SPEC_STATUSES = {"pending_approval", "rejected"}

# Maps the bootstrap tag Jenkins is building to the env that requested it.
# Used to scope /spec lookups so re-running an old tag picks up the spec from
# the deployment that originally requested that env, not just whatever was
# submitted most recently.
_TAG_ENV_MAP = {"v0.0.0-alpha": "staging", "v0.0.0": "production"}


@router.get("/spec/{repo_slug}")
async def get_jenkins_spec(repo_slug: str, request: Request, tag: str | None = None):
    """Jenkins-only: serve spec.json for an approved deployment of <slug>.

    Auth: `Authorization: Bearer <JENKINS_SHARED_SECRET>` header. Same value is
    held in Jenkins as the `jenkins-shared-secret` credential.

    Used by `bootstrapManifests` in Jenkinsfile.default — Jenkins curls this to
    get the full spec rather than constructing a stub.

    When `tag` is supplied (e.g. v0.0.0-alpha, v0.0.0) it's mapped to the
    requested env and the lookup is scoped to deployments that asked for that
    env. Without `tag`, returns the most-recently-created approved deployment.
    Scoping matters when the same repo has multiple sequential submissions:
    re-triggering a staging tag should pick up the staging deployment's spec,
    not whichever form was filled out last.

    Returns 503 if JENKINS_SHARED_SECRET isn't configured (endpoint disabled),
    401 on token mismatch, 404 if no usable deployment exists for the slug.
    """
    if not settings.JENKINS_SHARED_SECRET:
        raise HTTPException(
            status_code=503,
            detail="Spec endpoint disabled — JENKINS_SHARED_SECRET not set",
        )
    auth_header = request.headers.get("authorization", "")
    if auth_header != f"Bearer {settings.JENKINS_SHARED_SECRET}":
        raise HTTPException(status_code=401, detail="Unauthorized")

    query = [
        DeploymentRequest.repo_slug == repo_slug,
        {"status": {"$nin": list(_NO_SPEC_STATUSES)}},
    ]
    if tag in _TAG_ENV_MAP:
        query.append({"environments": _TAG_ENV_MAP[tag]})

    dep = await DeploymentRequest.find_one(*query, sort=[("createdAt", -1)])
    if not dep:
        scope = f" (tag={tag}, env={_TAG_ENV_MAP[tag]})" if tag in _TAG_ENV_MAP else ""
        raise HTTPException(
            status_code=404,
            detail=f"No approved deployment found for {repo_slug}{scope}",
        )
    return _build_jenkins_spec(dep)


@router.post("", status_code=201)
async def create_deployment(body: CreateDeploymentRequest):
    """Public: any dev can submit. Request enters pending_approval; no dispatch yet."""
    try:
        slug = parse_repo_slug(body.repo_url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    dep = DeploymentRequest(
        repo_slug=slug,
        repo_url=body.repo_url,
        team=body.team,
        workload_kind=body.workload_kind,
        role=body.role,
        cluster=body.cluster,
        environments=body.environments,
        env_vars=body.env_vars,
        domain=body.domain,
        port=body.port,
        args=body.args,
        hpa=body.hpa,
        requested_by=body.requested_by,
    )
    await dep.insert()

    # Preview-only at submission time — just so the dev sees what would happen.
    preview = await _build_planned(dep)

    print("=" * 60)
    print(f"[DEPLOYMENT SUBMITTED] {slug} — awaiting DevOps approval")
    print(f"  requested_by: {dep.requested_by}")
    print(f"  track_token : {dep.track_token}")
    print("=" * 60, flush=True)

    return {**serialize(dep), "planned": preview}


@router.post("/{deployment_id}/approve")
async def approve_deployment(
    deployment_id: str,
    admin: User = Depends(require_admin),
):
    dep = await DeploymentRequest.get(deployment_id)
    if not dep:
        raise HTTPException(status_code=404, detail="Deployment not found")
    if dep.status != "pending_approval":
        raise HTTPException(
            status_code=409,
            detail=f"Cannot approve — current status is '{dep.status}'",
        )

    dep.approved_by = admin.email
    dep.approved_at = datetime.now(timezone.utc)
    dep.status = "approved"
    await dep.save()

    planned = await _build_planned(dep)

    if settings.PULSE_DRY_RUN:
        _log_dry_run(planned)
        dep.status = "dry_run"
        await dep.save()
        return {**serialize(dep), "planned": planned, "dryRun": True}

    # Live dispatch — phase 1. Stops at tags_pushed; the completed stage waits
    # for Jenkins to call back (phase 2).
    try:
        webhook_result = await add_webhook(dep.repo_slug)
        print(
            f"[DEPLOYMENT DISPATCH] {dep.repo_slug} webhook: {webhook_result}",
            flush=True,
        )
        dep.status = "webhook_added"
        await dep.save()

        for action in planned["tags"]:
            name = action["name"]
            if action["action"] == "delete_tag":
                result = await delete_tag(dep.repo_slug, name)
                print(f"[DEPLOYMENT DISPATCH] {dep.repo_slug} delete {name}: {result}", flush=True)
            elif action["action"] == "push_tag":
                result = await push_tag(dep.repo_slug, name)
                print(f"[DEPLOYMENT DISPATCH] {dep.repo_slug} push {name}: {result}", flush=True)

        dep.status = "tags_pushed"
        await dep.save()

        # Publish full spec + queue a one-shot job claim for Jenkins.
        # Pulse stays the source of truth; Jenkins reads pulse:spec:<slug> at
        # bootstrap time and RPOPs pulse:queue:<slug> to claim this build.
        try:
            spec = _build_jenkins_spec(dep)
            publish_spec(dep.repo_slug, spec)
            job_id = enqueue_job(
                dep.repo_slug,
                deployment_id=str(dep.id),
                requested_by=dep.requested_by,
            )
            print(
                f"[DEPLOYMENT DISPATCH] {dep.repo_slug} redis spec+queue published"
                f" (job_id={job_id})",
                flush=True,
            )
        except Exception as redis_exc:
            traceback.print_exc()
            dep.status = "failed"
            dep.error = f"Redis publish failed: {redis_exc}"
            await dep.save()
            raise HTTPException(
                status_code=502,
                detail=f"Tags pushed but Redis publish failed: {redis_exc}",
            )

        print(
            f"[DEPLOYMENT DISPATCH] {dep.repo_slug} done — Jenkins should pick it up now",
            flush=True,
        )
    except HTTPException:
        raise
    except Exception as exc:
        traceback.print_exc()
        dep.status = "failed"
        dep.error = str(exc)
        await dep.save()
        raise HTTPException(
            status_code=502, detail=f"Dispatch failed at {dep.status}: {exc}"
        )

    return {**serialize(dep), "planned": planned, "dryRun": False}


@router.post("/{deployment_id}/reject")
async def reject_deployment(
    deployment_id: str,
    body: RejectDeploymentRequest,
    admin: User = Depends(require_admin),
):
    dep = await DeploymentRequest.get(deployment_id)
    if not dep:
        raise HTTPException(status_code=404, detail="Deployment not found")
    if dep.status != "pending_approval":
        raise HTTPException(
            status_code=409,
            detail=f"Cannot reject — current status is '{dep.status}'",
        )

    dep.status = "rejected"
    dep.rejection_reason = body.reason
    dep.approved_by = admin.email  # records who decided, approve or reject
    dep.approved_at = datetime.now(timezone.utc)
    await dep.save()

    print(
        f"[DEPLOYMENT REJECTED] {dep.repo_slug} by {admin.email}"
        f" — reason: {body.reason or '(no reason)'}",
        flush=True,
    )

    return serialize(dep)


# Terminal states: callbacks for repos in these states are ignored.
_TERMINAL_STATUSES = {
    "completed",
    "failed",
    "failed_build",
    "failed_manifest",
    "rejected",
    "dry_run",
}


@router.post("/callback/{repo_slug}")
async def pipeline_callback(repo_slug: str, body: PipelineCallback):
    """Jenkins -> Pulse callback. Advances the most recent non-terminal
    deployment for this repo slug to the reported phase."""
    dep = await DeploymentRequest.find_one(
        DeploymentRequest.repo_slug == repo_slug,
        {"status": {"$nin": list(_TERMINAL_STATUSES)}},
        sort=[("createdAt", -1)],
    )
    if not dep:
        # No active deployment for this repo — common when Jenkins rebuilds
        # a tag without a Pulse submission (e.g., dev tagged manually).
        print(
            f"[PIPELINE CALLBACK] {repo_slug} status={body.status}"
            f" — no active deployment to advance",
            flush=True,
        )
        return {"matched": False, "repoSlug": repo_slug}

    dep.status = body.status
    if body.status == "failed" and body.error:
        dep.error = body.error
    await dep.save()

    print(
        f"[PIPELINE CALLBACK] {repo_slug} → {body.status}"
        f" (deployment {dep.id})",
        flush=True,
    )
    return {"matched": True, "repoSlug": repo_slug, "deploymentId": str(dep.id), "status": dep.status}
