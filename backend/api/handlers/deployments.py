import traceback
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request

from api.deps import require_admin
from core.config import settings
from models.deployment import DeploymentRequest
from models.user import User
from schemas.deployment import (
    ApproveDeploymentRequest,
    CreateDeploymentRequest,
    PipelineCallback,
    RejectDeploymentRequest,
)
from services.bitbucket import (
    BOOTSTRAP_TAGS,
    add_webhook,
    classify_tags,
    delete_tag,
    fetch_repo_file,
    inspect_repo,
    list_tags,
    parse_repo_slug,
    push_tag,
)
from services.redis_specs import enqueue_job, publish_spec
from schemas.workers import WorkersParseError, parse_workers_yaml

router = APIRouter(prefix="/deployments", tags=["deployments"])

REGISTRY = "zen0hub"

_CLUSTER_TOLERATIONS = {
    "kl-1": [{"key": "proj", "operator": "Equal", "value": "salina", "effect": "NoSchedule"}],
    "kl-2": [{"key": "dept", "operator": "Equal", "value": "dc", "effect": "NoSchedule"}],
}

# Per-cluster ArgoCD UI base. kl-1 has a public ingress; kl-2 ArgoCD is only
# reachable on the cluster LAN via NodePort. UI links are computed here so a
# central change doesn't require touching every frontend that renders them.
_ARGOCD_BASE = {
    "kl-1": "https://argocd-kl.media-meter.in",
    "kl-2": "http://192.168.12.16:30443",
}


def _argocd_links(cluster: str, app: str, environments: list[str]) -> dict[str, str]:
    base = _ARGOCD_BASE.get(cluster)
    if not base:
        return {}
    return {
        # Naming pattern from kl-1/applicationset.yml:
        #   '{{ index .path.segments 1 }}-app-{{ .path.basename }}'
        # i.e. <app>-app-<env>, not <app>-<env>.
        env: f"{base}/applications/argocd/{app}-app-{env}"
        for env in environments
    }


def _host_aliases_for(cluster: str) -> list[dict]:
    """Mongo + arbiter hostAliases per cluster. kl-1 and kl-2 share the
    192.168.10.0/24 mongo network — replica set members at .10–.13, arbiter at .33."""
    if cluster not in ("kl-1", "kl-2"):
        return []
    return [
        {"ip": "192.168.10.10", "hostnames": ["mongodb1"]},
        {"ip": "192.168.10.11", "hostnames": ["mongodb2"]},
        {"ip": "192.168.10.12", "hostnames": ["mongodb3"]},
        {"ip": "192.168.10.13", "hostnames": ["mongodb4"]},
        {"ip": "192.168.10.33", "hostnames": ["arbiter"]},
    ]


# Role → default container args. Empty string = let the image's CMD run as-is.
# Streamlit is the only role where the image's CMD is rarely the right thing —
# most python base images CMD into a shell, so we always pass `streamlit run …`.
_ROLE_DEFAULT_ARGS: dict[str, dict[str, str]] = {
    "Streamlit": {
        "server": "run\nstreamlit_app.py\n--server.port=8501\n--server.address=0.0.0.0\n--server.headless=true"
    },
}


def _derive_profile(
    team: str, role: str | None, kind: str, with_worker: bool = False
) -> str | None:
    """Map (team, role, kind, with_worker) → generate-manifests.sh profile."""
    # DC/ML ScaledJob is always multi-worker — devops/workers.yaml in the repo
    # is the source of truth; the bootstrap script scaffolds N children from it.
    if team == "DC/ML" and kind == "ScaledJob":
        return "multi-worker"
    if kind != "Deployment":
        return None
    if team == "Frontend" or role == "UI":
        return "ui"
    if role == "Worker":
        return "worker"
    if role == "Streamlit":
        # The script's streamlit template pins port 8501, sets
        # `streamlit run main.py` as the container command, adds
        # session affinity on the Service, and bumps baseline resources.
        return "streamlit"
    if role == "API" and with_worker:
        return "api-worker"
    return "api"


def _build_jenkins_spec(d: DeploymentRequest) -> dict:
    """Construct the spec.json content Jenkins will read from Redis."""
    image = f"{REGISTRY}/{d.repo_slug}"
    app = d.repo_slug.replace("_", "-")
    profile = _derive_profile(d.team, d.role, d.workload_kind, d.with_worker)
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
    # ScaledJob multi-worker spec: emit only when present so the generator's
    # dispatch (`spec.workers // empty`) routes to scaledjob-multi.sh.
    if d.workers:
        spec["workers"] = d.workers
    if profile:
        spec["profile"] = profile
    spec["domainZone"] = d.domain_zone
    if d.domain:
        spec["domain"] = d.domain
    # Explicit ingress override: omit when None so generate-manifests.sh
    # falls back to its default (true for ingress-bearing profiles).
    if d.needs_ingress is not None:
        spec["needsIngress"] = d.needs_ingress
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
        # values automatically. Staging stays small (1–3); production keeps a
        # 2-pod floor so HA + rolling updates work without downtime, scaling
        # up to 5. Both target 80% CPU. Override via `hpa` field if needed.
        autoscaler = {
            "type": "HPA",
            "staging":    {"min": 1, "max": 3, "target_cpu": 80},
            "production": {"min": 2, "max": 5, "target_cpu": 80},
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
    if d.team == "DC/ML":
        return f"{d.cluster}/data-collection/{d.repo_slug}/"
    return f"{d.cluster}/{d.repo_slug}/"


def serialize(d: DeploymentRequest) -> dict:
    app = d.repo_slug.replace("_", "-")
    return {
        "_id": str(d.id),
        "repoSlug": d.repo_slug,
        "repoUrl": d.repo_url,
        "team": d.team,
        "workloadKind": d.workload_kind,
        "role": d.role,
        "withWorker": d.with_worker,
        "cluster": d.cluster,
        "environments": d.environments,
        "envVars": d.env_vars,
        "domain": d.domain,
        "domainZone": d.domain_zone,
        "port": d.port,
        "args": d.args,
        "hpa": d.hpa,
        "manifestPath": _manifest_path(d),
        "status": d.status,
        "error": d.error,
        "envStatuses": d.env_statuses or {},
        "envErrors": d.env_errors or {},
        "argocdLinks": _argocd_links(d.cluster, app, d.environments),
        "requestedBy": d.requested_by,
        "approvedBy": d.approved_by,
        "approvedAt": d.approved_at.isoformat() if d.approved_at else None,
        "rejectionReason": d.rejection_reason,
        "trackToken": d.track_token,
        "trackUrl": f"/deploy/track/{d.track_token}",
        "submissionId": d.submission_id,
        "workers": d.workers,
        "needsIngress": d.needs_ingress,
        "createdAt": d.created_at.isoformat(),
    }


def serialize_public(d: DeploymentRequest) -> dict:
    """Public-safe view. No requester email, no _id."""
    app = d.repo_slug.replace("_", "-")
    return {
        "repoSlug": d.repo_slug,
        "team": d.team,
        "workloadKind": d.workload_kind,
        "role": d.role,
        "withWorker": d.with_worker,
        "cluster": d.cluster,
        "environments": d.environments,
        "envVars": d.env_vars,
        "domain": d.domain,
        "domainZone": d.domain_zone,
        "port": d.port,
        "args": d.args,
        "hpa": d.hpa,
        "manifestPath": _manifest_path(d),
        "status": d.status,
        "error": d.error,
        "envStatuses": d.env_statuses or {},
        "envErrors": d.env_errors or {},
        "argocdLinks": _argocd_links(d.cluster, app, d.environments),
        "rejectionReason": d.rejection_reason,
        "approvedAt": d.approved_at.isoformat() if d.approved_at else None,
        "trackToken": d.track_token,
        "submissionId": d.submission_id,
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
    """Public: look up a deployment request by its opaque track token.

    SEV — the response bundles every sibling record (same submission_id)
    so a multi-env submit renders all its envs under ONE tracker URL,
    even though each env is its own independent record on the backend.

    submission_id is a display-only foreign-key; nothing on the write
    path reads or aggregates it, so it can't re-introduce the aggregate
    race we just fixed.

    Response shape:
        { primaryToken, submissionId, records: [public_record, ...] }
    Records are sorted staging-first so the UI rendering is stable.
    Legacy single-record submissions return one record with no siblings.
    """
    dep = await DeploymentRequest.find_one(DeploymentRequest.track_token == token)
    if not dep:
        raise HTTPException(status_code=404, detail="Tracking link not found")
    records = [dep]
    if dep.submission_id:
        siblings = await DeploymentRequest.find(
            DeploymentRequest.submission_id == dep.submission_id,
            DeploymentRequest.id != dep.id,
        ).to_list()
        records.extend(siblings)
    # Stable staging-before-production ordering for the UI (alphabetical
    # would put production first; we want the bootstrap/promotion order).
    _ENV_ORDER = {"staging": 0, "production": 1}
    records.sort(key=lambda r: _ENV_ORDER.get(
        r.environments[0] if r.environments else "", 99
    ))
    return {
        "primaryToken": token,
        "submissionId": dep.submission_id,
        "records": [serialize_public(r) for r in records],
    }


@router.get("/inspect/{repo_slug}")
async def inspect_repo_handler(repo_slug: str):
    """Pre-submit check used by the deployment form.

    Reports which build-relevant files exist in the Bitbucket repo so the
    form can block submission when the default pipeline would fail (no
    devops/Dockerfile.* and no custom Jenkinsfile), AND which envs are
    already bootstrapped in manifests-seven-gen-v2 across both clusters
    so the form can disable already-deployed env chips.
    """
    return await inspect_repo(repo_slug)


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
    spec = _build_jenkins_spec(dep)
    # When the build is tag-scoped, narrow environments to just the one this
    # tag is bootstrapping. Otherwise parallel staging/prod builds would each
    # generate both env subtrees from the spec, race on git push, and only
    # one commit message would land.
    if tag in _TAG_ENV_MAP:
        spec["environments"] = [_TAG_ENV_MAP[tag]]
    return spec


@router.post("", status_code=201)
async def create_deployment(body: CreateDeploymentRequest):
    """Public: any dev can submit.

    SEV — one DeploymentRequest per env. A form submit for
    `[staging, production]` produces two independent records, each with
    its own track_token and lifecycle. Sibling records share a
    `submission_id` so the form/admin can group them. This eliminates
    the aggregate-status race that bit us pre-SEV: each record's
    `status` is just its single env's state, no synthesis required.
    """
    try:
        slug = parse_repo_slug(body.repo_url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not body.environments:
        raise HTTPException(status_code=400, detail="At least one environment is required.")

    # ScaledJob: pull devops/workers.yml from the customer's repo and parse.
    # The spec is stored on every record so Phase 2's manifest generator
    # consumes it without re-fetching. Bad YAML or schema errors → 400 with
    # line-grained messages so the dev can fix workers.yml.
    parsed_workers = None
    if body.workload_kind == "ScaledJob":
        workers_yaml = await fetch_repo_file(slug, "devops/workers.yml")
        if not workers_yaml:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"ScaledJob requires devops/workers.yml at the root of "
                    f"the {slug} repo. See manComm/05-14-26/JER-dc-ml-scrapers.md "
                    f"for the schema."
                ),
            )
        try:
            parsed_workers = parse_workers_yaml(workers_yaml).model_dump()
        except WorkersParseError as e:
            raise HTTPException(
                status_code=400,
                detail={
                    "message": "devops/workers.yml failed validation",
                    "errors": e.errors,
                },
            )

    submission_id = uuid.uuid4().hex
    created: list[DeploymentRequest] = []
    for env in body.environments:
        env_vars_for_env = (body.env_vars or {}).get(env, "")
        dep = DeploymentRequest(
            repo_slug=slug,
            repo_url=body.repo_url,
            team=body.team,
            workload_kind=body.workload_kind,
            role=body.role,
            with_worker=body.with_worker,
            cluster=body.cluster,
            environments=[env],
            env_vars={env: env_vars_for_env} if env_vars_for_env else {},
            domain=body.domain,
            domain_zone=body.domain_zone,
            port=body.port,
            args=body.args,
            hpa=body.hpa,
            requested_by=body.requested_by,
            submission_id=submission_id,
            workers=parsed_workers,
            needs_ingress=body.needs_ingress,
        )
        await dep.insert()
        created.append(dep)

    print("=" * 60)
    print(f"[DEPLOYMENT SUBMITTED] {slug} — {len(created)} env record(s), awaiting DevOps approval")
    print(f"  submission_id: {submission_id}")
    print(f"  requested_by : {created[0].requested_by}")
    for d in created:
        env_name = d.environments[0] if d.environments else "(none)"
        print(f"  {env_name:10s}  id={d.id}  token={d.track_token}")
    print("=" * 60, flush=True)

    out = []
    for d in created:
        preview = await _build_planned(d)
        out.append({**serialize(d), "planned": preview})
    return out


@router.post("/{deployment_id}/approve")
async def approve_deployment(
    deployment_id: str,
    body: ApproveDeploymentRequest = ApproveDeploymentRequest(),
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

    # DevOps overrides env_vars at approve-time (internal connection strings,
    # secrets, etc.). Only update keys for envs that were actually requested —
    # blocks for non-requested envs would never reach Jenkins anyway, but it
    # keeps the stored doc cleaner.
    if body.env_vars:
        merged = dict(dep.env_vars or {})
        for env in dep.environments:
            if env in body.env_vars:
                merged[env] = body.env_vars[env]
        dep.env_vars = merged

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


# Failure phases. Per-env, these are terminal — once an env hits one of these,
# further callbacks for that env are ignored. The success-terminal "completed"
# is per-env too, so a completed prod no longer swallows a failed staging.
_FAILURE_STATUSES = {"failed", "failed_build", "failed_manifest", "rejected"}
_PER_ENV_TERMINAL = _FAILURE_STATUSES | {"completed"}

# Phase ordering for the worst-of aggregate. Failures rank highest so any env
# failure surfaces on the aggregate pill. completed ranks lowest among terminals
# so it only wins when every env is also completed.
#
# New step-by-step statuses (Jenkinsfile fires AT START of each stage so
# Pulse mirrors Jenkins's stage view exactly):
#   building_image    → kaniko running RIGHT NOW
#   pushing_manifest  → manifest gen + git push running RIGHT NOW
#   cleaning_up       → workspace wipe + notify hooks running RIGHT NOW
# Legacy "X done" statuses (image_built, manifest_pushed) share the same
# ranks for backwards-compat with already-bootstrapped records.
_PHASE_RANK: dict[str, int] = {
    "pending_approval": 0,
    "pending":          0,
    "approved":         1,
    "dry_run":          1,
    "webhook_added":    2,
    "tags_pushed":      3,
    "building_image":   4,
    "image_built":      4,
    "pushing_manifest": 5,
    "manifest_pushed":  5,
    "cleaning_up":      6,
    "completed":        7,
    # Failures rank highest — worst-of picks them over any in-flight env.
    "failed":           10,
    "failed_build":     11,
    "failed_manifest":  12,
    "rejected":         13,
}


def _aggregate_status(envs: list[str], env_statuses: dict[str, str], fallback: str) -> str:
    """Worst-of across env_statuses. Failures > non-terminal > completed.

    `fallback` is the legacy pre-callback status (pending_approval, approved,
    webhook_added, tags_pushed) — used when no env has reported yet AND
    folded into the min() when some envs haven't reported, so the aggregate
    can't synthesize "completed" from a single env's report while the other
    is still silent."""
    reported = [env_statuses.get(e) for e in envs if env_statuses.get(e)]
    if not reported:
        return fallback
    # If any env failed, that failure wins.
    failures = [s for s in reported if s in _FAILURE_STATUSES]
    if failures:
        return max(failures, key=lambda s: _PHASE_RANK.get(s, 0))
    # Completed only wins if EVERY requested env is completed.
    if all(s == "completed" for s in reported) and len(reported) == len(envs):
        return "completed"
    # Some env hasn't reported yet — include the fallback in the worst-of
    # so production hitting "completed" first can't bypass staging while
    # staging is still mid-build. Without this fold-in, min([completed])
    # would naively return "completed".
    pool = list(reported)
    if len(reported) < len(envs):
        pool.append(fallback)
    return min(pool, key=lambda s: _PHASE_RANK.get(s, 0))


@router.post("/callback/{repo_slug}")
async def pipeline_callback(repo_slug: str, body: PipelineCallback):
    """Jenkins -> Pulse callback. Updates per-env status on the most recent
    deployment for this repo+env, then recomputes the aggregate `status` as
    worst-of across all requested envs.

    Older callbacks without `env` set still work — they update the aggregate
    directly (legacy path)."""
    # Per-env path: scope the lookup to deployments that actually requested
    # this env, and where THIS env is not yet terminal. That way a completed
    # production can never swallow a failed_manifest staging callback.
    if body.env:
        dep = await DeploymentRequest.find_one(
            DeploymentRequest.repo_slug == repo_slug,
            {"environments": body.env},
            # SEV records store the env's state in `status`, so this catches
            # already-completed/failed single-env records that have an empty
            # env_statuses dict.
            {"status": {"$nin": list(_PER_ENV_TERMINAL)}},
            # Legacy multi-env: also block writing to an env slot that's
            # already terminal (e.g. failed_manifest must not be overwritten
            # by a stale 'completed' callback from the other env).
            {f"env_statuses.{body.env}": {"$nin": list(_PER_ENV_TERMINAL)}},
            sort=[("createdAt", -1)],
        )
    else:
        # Legacy: match any non-terminal aggregate.
        dep = await DeploymentRequest.find_one(
            DeploymentRequest.repo_slug == repo_slug,
            {"status": {"$nin": list(_PER_ENV_TERMINAL | {"dry_run"})}},
            sort=[("createdAt", -1)],
        )

    if not dep:
        print(
            f"[PIPELINE CALLBACK] {repo_slug} status={body.status}"
            f" env={body.env or '?'} — no active deployment to advance",
            flush=True,
        )
        return {"matched": False, "repoSlug": repo_slug}

    if body.env:
        # SEV: single-env records map status directly — no aggregate needed,
        # no synthesis-race possible. We detect this by environments being
        # exactly [body.env]. Legacy multi-env records fall through to the
        # env_statuses + worst-of aggregate path.
        if len(dep.environments) == 1 and dep.environments[0] == body.env:
            dep.status = body.status
            if body.status in _FAILURE_STATUSES and body.error:
                dep.error = body.error
        else:
            # Legacy multi-env record. Initialize the dicts (Beanie keeps
            # Pydantic defaults but older docs may not have them populated).
            env_statuses = dict(dep.env_statuses or {})
            env_errors = dict(dep.env_errors or {})
            env_statuses[body.env] = body.status
            if body.error and body.status in _FAILURE_STATUSES:
                env_errors[body.env] = body.error
            dep.env_statuses = env_statuses
            dep.env_errors = env_errors
            dep.status = _aggregate_status(
                dep.environments, env_statuses, fallback=dep.status
            )
            if env_errors:
                dep.error = next(iter(env_errors.values()))
    else:
        dep.status = body.status
        if body.status in _FAILURE_STATUSES and body.error:
            dep.error = body.error

    await dep.save()

    print(
        f"[PIPELINE CALLBACK] {repo_slug} env={body.env or 'legacy'}"
        f" → {body.status} (aggregate={dep.status}, id={dep.id})",
        flush=True,
    )
    return {
        "matched": True,
        "repoSlug": repo_slug,
        "deploymentId": str(dep.id),
        "status": dep.status,
        "envStatuses": dep.env_statuses,
    }
