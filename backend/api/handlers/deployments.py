import re
import traceback
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request

from api.deps import require_admin
from core.config import settings
from models.deployment import DeploymentRequest
from models.user import User
from schemas.deployment import (
    AddWorkerRequest,
    ApproveDeploymentRequest,
    CreateDeploymentRequest,
    PipelineCallback,
    RejectDeploymentRequest,
)
from services.bitbucket import (
    BOOTSTRAP_TAGS,
    add_webhook,
    classify_tags,
    commit_file,
    create_branch,
    delete_tag,
    fetch_repo_file,
    inspect_repo,
    list_tags,
    list_tags_detailed,
    next_alpha_tag,
    parse_repo_slug,
    push_tag,
)
from services.redis_specs import enqueue_job, publish_spec
from services import kafka_events
from models.deployment_event import DeploymentEvent
from services.discord_deploy_notifier import (
    notify_decision,
    notify_pending_approval,
)
from schemas.components import ComponentsParseError, parse_components_yaml
from schemas.workers import WorkersParseError, parse_workers_yaml

router = APIRouter(prefix="/deployments", tags=["deployments"])

REGISTRY = "zen0hub"


def _iso_utc(dt):
    """Emit an ISO string with explicit +00:00 offset.

    Beanie strips tzinfo on write for older records, so we can't rely
    on the stored value carrying an offset. Assume Mongo UTC when
    tzinfo is missing — matches the datetime.now(timezone.utc) writes
    we use throughout. Prevents browsers from parsing bare ISO strings
    as their local TZ (bug: PHT viewer saw values 8h behind reality).
    """
    if not dt:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()

_CLUSTER_TOLERATIONS = {
    "kl-1": [{"key": "proj", "operator": "Equal", "value": "salina", "effect": "NoSchedule"}],
    "kl-2": [{"key": "dept", "operator": "Equal", "value": "dc", "effect": "NoSchedule"}],
    # net3 mirrors kl-2 (DC/ML pattern). Landed with the net3 ApplicationSet.
    "net3": [{"key": "dept", "operator": "Equal", "value": "dc", "effect": "NoSchedule"}],
}

# Per-cluster ArgoCD UI base. kl-1 has a public ingress; kl-2/net3 ArgoCD are
# only reachable on the cluster LAN via NodePort. UI links are computed here
# so a central change doesn't require touching every frontend that renders them.
_ARGOCD_BASE = {
    "kl-1": "https://argocd-kl.media-meter.in",
    "kl-2": "http://192.168.12.16:30443",
    "net3": "https://192.168.3.28:30247",
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
    """Mongo + arbiter hostAliases per cluster. kl-1, kl-2, and net3 all share
    the 192.168.10.0/24 mongo network — replica set members at .10–.13,
    arbiter at .33."""
    if cluster not in ("kl-1", "kl-2", "net3"):
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
        # Infisical scope. When enabled the generator emits an
        # InfisicalSecret CR patch under environments/<env>/. Project
        # slug follows the same hyphenated convention as `app` so a
        # dev browsing the Infisical UI can match the repo at a
        # glance.
        "secretsEnabled": bool(d.secrets_enabled),
        "infisicalProjectSlug": d.repo_slug.replace("_", "-"),
    }
    # ScaledJob multi-worker spec: emit only when present so the generator's
    # dispatch (`spec.workers // empty`) routes to scaledjob-multi.sh.
    if d.workers:
        spec["workers"] = d.workers
    # Monorepo / polyworkload spec (devops/components.yml). Generator's
    # Phase 2 branch fans out per image_target — Pattern A renders N flat
    # trees, Pattern B emits a nested polyworkload tree (partial — falls
    # back to single-app today).
    if d.components:
        spec["components"] = d.components
        spec["image_target"] = d.image_target or "per-component"
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
        "approvedAt": _iso_utc(d.approved_at),
        "rejectionReason": d.rejection_reason,
        "trackToken": d.track_token,
        "trackUrl": f"/deploy/track/{d.track_token}",
        "submissionId": d.submission_id,
        "workers": d.workers,
        "needsIngress": d.needs_ingress,
        "secretsEnabled": bool(d.secrets_enabled),
        "createdAt": _iso_utc(d.created_at),
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
        "approvedAt": _iso_utc(d.approved_at),
        "trackToken": d.track_token,
        "submissionId": d.submission_id,
        "createdAt": _iso_utc(d.created_at),
        "attempt": int(d.attempt or 1),
        "latestBuildId": d.latest_build_id,
        "latestLogExcerpt": d.latest_log_excerpt,
        "latestJenkinsBuildUrl": d.latest_jenkins_build_url,
        "latestJenkinsConsoleUrl": d.latest_jenkins_console_url,
        "origin": getattr(d, "origin", "form"),
        # Fall back to the bootstrap tag the pipeline pushes for this env
        # so old form records (predating the tag field) still render a
        # value. Overwrites on real callback via `dep.tag` update path.
        "tag": getattr(d, "tag", None) or _bootstrap_tag_for(d),
    }


def _bootstrap_tag_for(d: DeploymentRequest) -> Optional[str]:
    env = d.environments[0] if d.environments else None
    if env == "staging":
        return "v0.0.0-alpha"
    if env == "production":
        return "v0.0.0"
    return None


async def _build_planned(dep: DeploymentRequest) -> dict:
    """Compute the Jenkins dispatch plan (tag actions, webhook, etc.)."""
    existing_tags = await list_tags(dep.repo_slug)
    tag_class = classify_tags(existing_tags)

    env_tag_map = {"staging": "v0.0.0-alpha", "production": "v0.0.0"}
    # Per-env branch source — staging tag cuts from `staging` branch,
    # production cuts from the default branch (main or master). Pulse
    # auto-creates the staging branch from default during dispatch when
    # missing (see approve flow).
    env_branch_map = {"staging": "staging", "production": None}  # None = default branch
    planned_tag_names = [env_tag_map[e] for e in dep.environments]
    conflicted = set(tag_class["bootstrap"]) & set(planned_tag_names)

    tag_actions: list[dict] = []
    for env in dep.environments:
        tag = env_tag_map[env]
        from_branch = env_branch_map[env]
        if tag in conflicted:
            tag_actions.append(
                {"action": "delete_tag", "name": tag, "reason": "bootstrap tag already exists"}
            )
        tag_actions.append({"action": "push_tag", "name": tag, "from_branch": from_branch, "env": env})

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


@router.get("/repos")
async def list_repos(limit: int = 50):
    """Public: distinct repo slugs with latest-build summary. Powers the
    /deploy landing repo grid.

    Aggregation: bucket by repo_slug, take max(createdAt) as latest, plus
    counts. Cheap on our data volume (< 1k rows). Skips manual_tag
    entries with no meaningful metadata.
    """
    # Beanie stores fields under their JSON alias (camelCase) in Mongo,
    # so grouping keys must be the camelCase names — `$repoSlug`,
    # `$trackToken`, `$createdAt`, not the Python snake_case attributes.
    pipeline = [
        {"$sort": {"createdAt": -1}},
        {
            "$group": {
                "_id": "$repoSlug",
                "latest_status": {"$first": "$status"},
                "latest_env": {"$first": {"$arrayElemAt": ["$environments", 0]}},
                "latest_tag": {"$first": "$tag"},
                "latest_cluster": {"$first": "$cluster"},
                "latest_created_at": {"$first": "$createdAt"},
                "latest_track_token": {"$first": "$trackToken"},
                "total": {"$sum": 1},
            }
        },
        {"$sort": {"latest_created_at": -1}},
        {"$limit": max(1, min(limit, 200))},
    ]
    coll = DeploymentRequest.get_motor_collection()
    docs = await coll.aggregate(pipeline).to_list(length=limit)
    return [
        {
            "repoSlug": d["_id"],
            "latestStatus": d.get("latest_status"),
            "latestEnv": d.get("latest_env"),
            "latestTag": d.get("latest_tag"),
            "latestCluster": d.get("latest_cluster"),
            "latestCreatedAt": _iso_utc(d.get("latest_created_at")),
            "latestTrackToken": d.get("latest_track_token"),
            "total": d.get("total", 0),
        }
        for d in docs
    ]


_ALPHA_TAG_RE = re.compile(r"^v\d+\.\d+\.\d+-alpha$")
_PROD_TAG_RE = re.compile(r"^v\d+\.\d+\.\d+$")


def _env_for_tag(tag: str) -> Optional[str]:
    if _ALPHA_TAG_RE.match(tag):
        return "staging"
    if _PROD_TAG_RE.match(tag):
        return "production"
    return None


async def _backfill_repo_logic(repo_slug: str) -> dict:
    tags = await list_tags_detailed(repo_slug)
    if not tags:
        return {"repoSlug": repo_slug, "inserted": 0, "skipped": 0, "reason": "no tags"}

    existing = await DeploymentRequest.find(
        DeploymentRequest.repo_slug == repo_slug
    ).to_list()
    # (env, tag) → dep. `tag` may be null on old records; fall back to
    # the bootstrap tag for the env so we don't double-insert v0.0.0-alpha
    # against a legacy staging row that lacks a tag value.
    known: set[tuple[str, str]] = set()
    for d in existing:
        env = d.environments[0] if d.environments else None
        if not env:
            continue
        real_tag = d.tag or _bootstrap_tag_for(d)
        if real_tag:
            known.add((env, real_tag))

    inserted = 0
    skipped = 0
    workspace = settings.BITBUCKET_WORKSPACE
    for t in tags:
        name = t.get("name") or ""
        env = _env_for_tag(name)
        if not env:
            skipped += 1
            continue
        if (env, name) in known:
            skipped += 1
            continue
        raw_date = t.get("date")
        try:
            created_at = (
                datetime.fromisoformat(raw_date.replace("Z", "+00:00"))
                if raw_date
                else datetime.now(timezone.utc)
            )
        except Exception:
            created_at = datetime.now(timezone.utc)

        dep = DeploymentRequest(
            repo_slug=repo_slug,
            repo_url=f"https://bitbucket.org/{workspace}/{repo_slug}.git",
            team="Backend",
            workload_kind="Deployment",
            role=None,
            cluster="kl-1",
            environments=[env],
            env_vars={},
            domain_zone="media-meter.in",
            requested_by="backfill@pulse",
            status="completed",
            origin="manual_tag",
            tag=name,
            created_at=created_at,
        )
        await dep.insert()
        inserted += 1

    return {
        "repoSlug": repo_slug,
        "inserted": inserted,
        "skipped": skipped,
        "totalTags": len(tags),
    }


@router.post("/repo/{repo_slug}/backfill")
async def backfill_repo(repo_slug: str, admin: User = Depends(require_admin)):
    """Admin-only: pull all Bitbucket tags for a repo, create synthetic
    manual_tag records for tags Pulse doesn't know. Idempotent."""
    return await _backfill_repo_logic(repo_slug)


@router.post("/backfill")
async def backfill_all(admin: User = Depends(require_admin)):
    """Admin-only: backfill every repo Pulse knows about, serialized."""
    coll = DeploymentRequest.get_motor_collection()
    slugs = await coll.distinct("repoSlug")
    results = []
    for slug in slugs:
        try:
            r = await _backfill_repo_logic(slug)
            results.append(r)
        except Exception as e:
            results.append({"repoSlug": slug, "error": str(e)})
    total_inserted = sum(r.get("inserted", 0) for r in results)
    return {"repos": len(slugs), "inserted": total_inserted, "results": results}


@router.get("/repo/{repo_slug}")
async def list_repo_builds(repo_slug: str, limit: int = 50, skip: int = 0):
    """Public: all builds for one repo, newest first. Bitbucket-style
    build history. Reused by /deploy/repo/[slug] to render a build table.
    """
    docs = (
        await DeploymentRequest.find(DeploymentRequest.repo_slug == repo_slug)
        .sort("-createdAt")
        .skip(max(0, skip))
        .limit(max(1, min(limit, 200)))
        .to_list()
    )
    return {
        "repoSlug": repo_slug,
        "count": len(docs),
        "builds": [serialize_public(d) for d in docs],
    }


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


@router.get("/track/{token}/events")
async def track_deployment_events(token: str):
    """Return the full stage-event timeline for a tracker token.

    Rows are grouped by (env, attempt) so the tracker page can render one
    column per env and one attempt block per column. Kafka redeliveries
    already collapse at the DB via the unique (track_token, build_id,
    stage, state) index, so this endpoint is a straight read.
    """
    dep = await DeploymentRequest.find_one(DeploymentRequest.track_token == token)
    if not dep:
        raise HTTPException(status_code=404, detail="Tracking link not found")
    tokens = [token]
    if dep.submission_id:
        siblings = await DeploymentRequest.find(
            DeploymentRequest.submission_id == dep.submission_id
        ).to_list()
        tokens = [s.track_token for s in siblings]

    events = await DeploymentEvent.find(
        {"track_token": {"$in": tokens}}
    ).sort("ts").to_list()

    # Shape: {track_token: {attempt: [event, ...]}}
    grouped: dict[str, dict[int, list[dict]]] = {}
    for e in events:
        by_attempt = grouped.setdefault(e.track_token, {})
        by_attempt.setdefault(int(e.attempt or 1), []).append({
            "stage": e.stage,
            "state": e.state,
            "buildId": e.build_id,
            "jobId": e.job_id,
            "ts": _iso_utc(e.ts),
            "error": e.error,
            "logExcerpt": e.log_excerpt,
            "jenkinsBuildUrl": e.jenkins_build_url,
            "jenkinsConsoleUrl": e.jenkins_console_url,
        })
    return {
        "primaryToken": token,
        "submissionId": dep.submission_id,
        "timelines": grouped,
    }


@router.get("/track/{token}/console")
async def track_deployment_console(token: str, start: int = 0):
    """Proxy Jenkins's progressiveText log for the current build.

    Frontend polls with the last `offset` it received; server returns
    only the new bytes since then + a `more` flag. Jenkins is hit
    server-side so no admin creds leak to the browser.

    Returns:
      - 200 with { text, offset, more, buildNumber } on success
      - 200 with { text: "", offset: 0, more: false, buildNumber: null }
        when the build hasn't been created yet (Jenkins job not scanned).
        The frontend treats that as a no-op tick.
    """
    from services import jenkins_console

    dep = await DeploymentRequest.find_one(DeploymentRequest.track_token == token)
    if not dep:
        raise HTTPException(status_code=404, detail="Tracking link not found")

    # Prefer the actual dispatched tag persisted on the record — that's
    # the truth for both form + manual_tag records. Fall back to args
    # (legacy path) and finally the bootstrap tag for really old
    # records that never captured a tag.
    env = dep.environments[0] if dep.environments else "staging"
    bootstrap = "v0.0.0-alpha" if env == "staging" else "v0.0.0"
    if getattr(dep, "tag", None):
        tag = dep.tag
    elif isinstance(dep.args, dict) and dep.args.get("tag"):
        tag = dep.args["tag"]
    else:
        tag = bootstrap

    build_number: Optional[int] = None
    if dep.latest_build_id:
        try:
            build_number = int(dep.latest_build_id)
        except (TypeError, ValueError):
            build_number = None
    if build_number is None:
        build_number = await jenkins_console.fetch_last_build_number(
            dep.repo_slug, tag
        )
    if build_number is None:
        return {
            "text": "",
            "offset": 0,
            "more": False,
            "buildNumber": None,
            "tag": tag,
        }

    text, offset, more = await jenkins_console.fetch_progressive_log(
        dep.repo_slug, tag, build_number, max(0, int(start))
    )
    return {
        "text": text,
        "offset": offset,
        "more": more,
        "buildNumber": build_number,
        "tag": tag,
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

    # Monorepo / polyworkload: pull devops/components.yml + snapshot the
    # parsed spec onto every record. Generator reads spec.components +
    # spec.image_target to emit a nested polyworkload tree.
    #
    # Policy (2026-06-16): pulse-align is REQUIRED — every Pulse-managed
    # repo must declare devops/components.yml (or devops/workers.yml for
    # ScaledJob multi-worker repos). Form blocks submit client-side; this
    # is the server-side gate so direct API callers also hit it.
    parsed_components = None
    parsed_image_target = None
    components_yaml = await fetch_repo_file(slug, "devops/components.yml")
    if components_yaml:
        try:
            spec_obj = parse_components_yaml(components_yaml)
            parsed_components = [c.model_dump() for c in spec_obj.components]
            parsed_image_target = spec_obj.image_target
        except ComponentsParseError as e:
            raise HTTPException(
                status_code=400,
                detail={
                    "message": "devops/components.yml failed validation",
                    "errors": e.errors,
                },
            )
    elif body.workload_kind != "ScaledJob":
        # No components.yml AND not a ScaledJob multi-worker (which uses
        # workers.yml instead) → reject with a pulse-align hint.
        raise HTTPException(
            status_code=400,
            detail={
                "message": (
                    f"devops/components.yml is required on {slug}. Run "
                    f"the pulse-align skill in the repo, commit + push, "
                    f"then re-submit. See pulse-align SKILL.md in ash-tadi."
                ),
                "code": "MISSING_COMPONENTS_YML",
                "scaffolding_hint": "/pulse-align",
            },
        )

        # Form override semantics for needs_ingress on polyworkload repos.
        # The form has ONE checkbox covering the whole repo, but
        # components.yml declares needs_ingress per component. Rule:
        #   form needs_ingress = False (admin explicitly OFF)  → sweep ALL components to false
        #   form needs_ingress = True / None                   → leave components.yml values alone
        # i.e. the form can DISABLE ingress repo-wide but cannot force-
        # enable a component that didn't declare it. Keeps the mental
        # model simple — "uncheck = no ingress anywhere" — and prevents
        # accidentally exposing a worker that the repo intended private.
        if body.needs_ingress is False:
            for comp in parsed_components:
                if comp.get("needs_ingress"):
                    comp["needs_ingress"] = False

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
            components=parsed_components,
            image_target=parsed_image_target,
            needs_ingress=body.needs_ingress,
            secrets_enabled=body.secrets_enabled,
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

    # Best-effort Discord ping — never blocks the submit on outage.
    await notify_pending_approval(created)

    # SECTION END — `create_deployment` (kind="new"). The
    # `add_worker_deployment` endpoint below is the second submission
    # path, sharing the same DeploymentRequest collection + approval
    # flow but with a different approve action (workers.yml patch).
    out = []
    for d in created:
        preview = await _build_planned(d)
        out.append({**serialize(d), "planned": preview})
    return out


# Regex shared with schemas/workers.py — keep in sync.
_WORKER_NAME_RE = re.compile(r"^[A-Z][A-Z0-9_]*$")
_COMPONENT_NAME_RE = re.compile(r"^[a-z][a-z0-9-]*$")


@router.post("/add-worker", status_code=201)
async def add_worker_deployment(body: AddWorkerRequest):
    """Public: any dev can submit. Admin approves to apply.

    Creates a DeploymentRequest with kind="add_worker" that, on
    approval, edits the customer repo's devops/workers.yml + pushes a
    new alpha tag. Staging-only on the apply side (MVP).
    """
    try:
        slug = parse_repo_slug(body.repo_url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Shape validation matching schemas/workers.py.
    if not _COMPONENT_NAME_RE.match(body.component):
        raise HTTPException(
            status_code=400,
            detail=f"component name '{body.component}' must be lowercase letters/digits/dashes",
        )
    if not _WORKER_NAME_RE.match(body.worker):
        raise HTTPException(
            status_code=400,
            detail=f"worker name '{body.worker}' must be UPPERCASE letters/digits/underscores",
        )

    # Confirm the component exists in the current workers.yml so the
    # dev gets feedback at submit time rather than at approve time.
    current = await fetch_repo_file(slug, "devops/workers.yml")
    if not current:
        raise HTTPException(
            status_code=400,
            detail=f"devops/workers.yml missing on {slug} — add it first via a normal deploy.",
        )
    try:
        spec = parse_workers_yaml(current).model_dump()
    except WorkersParseError as e:
        raise HTTPException(
            status_code=400,
            detail={"message": "current devops/workers.yml fails validation", "errors": e.errors},
        )
    components_present = {c["name"] for c in spec.get("components", [])}
    if body.component not in components_present:
        raise HTTPException(
            status_code=400,
            detail=f"component '{body.component}' not in workers.yml. Present: {sorted(components_present)}",
        )
    # Block duplicates inside the chosen component.
    target_component = next(c for c in spec["components"] if c["name"] == body.component)
    if body.worker in (target_component.get("workers") or {}):
        raise HTTPException(
            status_code=409,
            detail=f"worker '{body.worker}' already exists under component '{body.component}'",
        )

    add_worker_spec = {
        "component": body.component,
        "worker": body.worker,
        "max": body.max_replicas,
        "batch": body.batch,
        "list_name": body.list_name,
    }
    submission_id = uuid.uuid4().hex
    dep = DeploymentRequest(
        repo_slug=slug,
        repo_url=body.repo_url,
        team="DC/ML",
        workload_kind="ScaledJob",
        role=None,
        cluster="kl-2",
        environments=["staging"],  # MVP: staging-only
        env_vars={},
        requested_by=body.requested_by,
        submission_id=submission_id,
        kind="add_worker",
        add_worker_spec=add_worker_spec,
    )
    await dep.insert()

    print("=" * 60)
    print(f"[ADD-WORKER SUBMITTED] {slug} — {body.component}/{body.worker}, awaiting DevOps approval")
    print(f"  submission_id: {submission_id}  id={dep.id}  token={dep.track_token}")
    print("=" * 60, flush=True)

    await notify_pending_approval([dep])
    return {**serialize(dep), "addWorkerSpec": add_worker_spec}


async def _apply_add_worker(dep: DeploymentRequest) -> dict:
    """Approve-time apply for kind="add_worker".

    1. Re-fetch devops/workers.yml fresh (covers race where another
       request landed first).
    2. Insert the new worker under the requested component.
    3. Commit the updated file back to Bitbucket.
    4. Compute next alpha tag from existing tags, push it.

    Returns a small summary the response card surfaces. Raises on any
    failure — caller catches and flips status to `failed`.
    """
    import yaml  # lazy — only imported on this code path

    spec = dep.add_worker_spec or {}
    component = spec["component"]
    worker = spec["worker"]

    current = await fetch_repo_file(dep.repo_slug, "devops/workers.yml")
    if not current:
        raise RuntimeError(f"devops/workers.yml vanished from {dep.repo_slug} between submit and approve")

    parsed = yaml.safe_load(current) or {}
    components = parsed.setdefault("components", {})
    comp_block = components.setdefault(component, {})
    if worker in comp_block:
        # Idempotent re-approve — caller wins the no-op.
        return {"skipped": True, "reason": f"{component}/{worker} already present"}

    # Build the per-worker entry. None values dropped so we don't
    # serialize empty fields — the schema's defaults apply at parse
    # time on the next pipeline run.
    entry: Dict[str, Any] = {}
    if spec.get("max") is not None:
        entry["max"] = spec["max"]
    if spec.get("batch") is not None:
        entry["batch"] = spec["batch"]
    if spec.get("list_name"):
        entry["list_name"] = spec["list_name"]
    comp_block[worker] = entry or {}  # `{}` shape = defaults

    updated = yaml.safe_dump(parsed, sort_keys=False, default_flow_style=False)

    commit_msg = f"add worker {component}/{worker} via Pulse ({dep.requested_by})"
    author = f"Pulse <{dep.requested_by}>"
    commit_res = await commit_file(
        dep.repo_slug, "devops/workers.yml", updated,
        message=commit_msg, author=author,
    )

    # Bump the latest alpha tag — Jenkins picks it up on push.
    existing = await list_tags(dep.repo_slug)
    new_tag = next_alpha_tag(existing)
    tag_res = await push_tag(dep.repo_slug, new_tag)
    dep.tag = new_tag
    await dep.save()

    return {
        "commit": commit_res.get("commit"),
        "tag": new_tag,
        "tag_result": tag_res,
        "component": component,
        "worker": worker,
    }


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

    # Discord ping — admin decided, share with team.
    await notify_decision(dep, approved=True)

    # Add-worker requests take a separate, smaller code path: patch
    # workers.yml and bump an alpha tag. Skip the new-app dry-run /
    # tag-bootstrap / spec-publish flow entirely.
    if dep.kind == "add_worker":
        try:
            result = await _apply_add_worker(dep)
            dep.status = "completed"
            await dep.save()
            return {**serialize(dep), "addWorkerResult": result}
        except Exception as exc:
            traceback.print_exc()
            dep.status = "failed"
            dep.error = f"add_worker apply failed: {exc}"
            await dep.save()
            raise HTTPException(status_code=502, detail=str(exc))

    planned = await _build_planned(dep)

    if settings.PULSE_DRY_RUN:
        _log_dry_run(planned)
        dep.status = "dry_run"
        await dep.save()
        return {**serialize(dep), "planned": planned, "dryRun": True}

    # Live dispatch — phase 1. Stops at tags_pushed; the completed stage waits
    # for Jenkins to call back (phase 2).
    # Infisical scope bootstrap. Runs BEFORE tag push so that the
    # InfisicalSecret CR emitted by the manifest generator finds an
    # existing project/env/folder when the operator reconciles. Soft
    # failure — a temporarily unhealthy Infisical shouldn't block the
    # deploy; the operator will re-sync once the folder appears.
    if dep.secrets_enabled:
        try:
            from services import infisical
            comps = dep.components or [{"name": "api"}]
            comp_paths = [f"/{c.get('name','api')}" for c in comps]
            project_slug = dep.repo_slug.replace("_", "-")
            await infisical.bootstrap_scope(
                project_slug=project_slug,
                project_name=dep.repo_slug,
                envs=list(dep.environments),
                paths=comp_paths,
            )
            print(
                f"[DEPLOYMENT DISPATCH] {dep.repo_slug} infisical scope ready"
                f" project={project_slug} envs={dep.environments} paths={comp_paths}",
                flush=True,
            )
        except Exception as infi_exc:
            traceback.print_exc()
            print(
                f"[DEPLOYMENT DISPATCH] {dep.repo_slug} infisical skipped: {infi_exc}",
                flush=True,
            )

    try:
        webhook_result = await add_webhook(dep.repo_slug)
        print(
            f"[DEPLOYMENT DISPATCH] {dep.repo_slug} webhook: {webhook_result}",
            flush=True,
        )
        dep.status = "webhook_added"
        await dep.save()

        # Track which branches we've already auto-created this dispatch
        # so we don't redundantly hit the create endpoint per env when
        # both envs pull from the same branch.
        ensured_branches: set[str] = set()

        for action in planned["tags"]:
            name = action["name"]
            if action["action"] == "delete_tag":
                result = await delete_tag(dep.repo_slug, name)
                print(f"[DEPLOYMENT DISPATCH] {dep.repo_slug} delete {name}: {result}", flush=True)
            elif action["action"] == "push_tag":
                from_branch = action.get("from_branch")  # None → default branch
                # Auto-create staging branch from default if missing —
                # devs at this org keep `staging` + `main`/`master`,
                # but new repos sometimes only have main at bootstrap.
                if from_branch and from_branch not in ensured_branches:
                    br_res = await create_branch(dep.repo_slug, from_branch)
                    print(
                        f"[DEPLOYMENT DISPATCH] {dep.repo_slug} ensure branch {from_branch}: {br_res}",
                        flush=True,
                    )
                    ensured_branches.add(from_branch)
                result = await push_tag(dep.repo_slug, name, from_branch=from_branch)
                print(
                    f"[DEPLOYMENT DISPATCH] {dep.repo_slug} push {name} "
                    f"(branch={from_branch or 'default'}): {result}",
                    flush=True,
                )
                # Persist the actual dispatched tag so the tracker + repo
                # browser show the real name, not a bootstrap fallback.
                # SEV: each record is single-env → last push_tag wins is
                # a no-op (only one push_tag per dep in the SEV path).
                dep.tag = name

        dep.status = "tags_pushed"
        await dep.save()

        # Publish full spec + queue a one-shot job claim for Jenkins.
        # Pulse stays the source of truth; Jenkins reads pulse:spec:<slug> at
        # bootstrap time and RPOPs pulse:queue:<slug> to claim this build.
        try:
            spec = _build_jenkins_spec(dep)
            # Attach the tracking IDs to the spec so Jenkins can echo them
            # back on every Kafka event → tracker page stays stable across
            # retries and rebuilds without Pulse having to look anything up.
            spec["trackToken"] = dep.track_token
            spec["submissionId"] = dep.submission_id
            spec["deploymentId"] = str(dep.id)
            spec["attempt"] = dep.attempt
            publish_spec(dep.repo_slug, spec)
            job_id = enqueue_job(
                dep.repo_slug,
                deployment_id=str(dep.id),
                requested_by=dep.requested_by,
            )
            # Dual-write to Kafka. When PULSE_STAGE_TRANSPORT flips to kafka
            # the Jenkins consumer switches; the Redis queue stays alive as
            # fallback for one release cycle before removal.
            try:
                env_for_job = dep.environments[0] if dep.environments else "staging"
                tag_for_job = (
                    f"{dep.args.get('tag', 'v0.0.0')}"
                    if isinstance(dep.args, dict)
                    else "v0.0.0"
                )
                kafka_job_id = await kafka_events.enqueue_job(
                    track_token=dep.track_token,
                    submission_id=dep.submission_id,
                    slug=dep.repo_slug,
                    env=env_for_job,
                    tag=tag_for_job,
                    requested_by=dep.requested_by,
                    deployment_id=str(dep.id),
                )
                dep.latest_job_id = kafka_job_id
            except Exception as kexc:
                # Kafka is best-effort during the dual-write window.
                print(f"[DEPLOYMENT DISPATCH] kafka enqueue skipped: {kexc}", flush=True)
            print(
                f"[DEPLOYMENT DISPATCH] {dep.repo_slug} redis spec+queue published"
                f" (job_id={job_id}, kafka_job_id={dep.latest_job_id})",
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

    await notify_decision(dep, approved=False, reason=body.reason)

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
        # Orphan-tag path: no matching form-submitted deployment. Auto-
        # create a synthetic record so the build has a tracker URL + shows
        # up in the repo browser. Only fires when both env + tag are
        # populated (older Jenkinsfiles without `tag` in the callback body
        # keep the legacy "no match" no-op).
        if body.env and body.tag:
            dep = DeploymentRequest(
                repo_slug=repo_slug,
                repo_url=f"https://bitbucket.org/{settings.BITBUCKET_WORKSPACE}/{repo_slug}.git",
                team="Backend",
                workload_kind="Deployment",
                role=None,
                cluster="kl-1",
                environments=[body.env],
                env_vars={},
                domain_zone="media-meter.in",
                requested_by="jenkins@ci",
                status=body.status,
                origin="manual_tag",
                tag=body.tag,
                latest_build_id=body.build_id,
                latest_log_excerpt=body.log_excerpt,
                latest_jenkins_build_url=body.jenkins_build_url,
                latest_jenkins_console_url=body.jenkins_console_url,
            )
            await dep.insert()
            print(
                f"[PIPELINE CALLBACK] {repo_slug} tag={body.tag} env={body.env}"
                f" — orphan-tag record synthesized (id={dep.id})",
                flush=True,
            )
        else:
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

    # Snapshot the latest Jenkins context onto the DeploymentRequest so
    # the tracker page renders without joining event log. Failure
    # excerpts + Jenkins URLs are the common case a dev needs on load.
    if body.tag and not dep.tag:
        dep.tag = body.tag
    if body.build_id:
        dep.latest_build_id = body.build_id
    if body.log_excerpt:
        dep.latest_log_excerpt = body.log_excerpt
    if body.jenkins_build_url:
        dep.latest_jenkins_build_url = body.jenkins_build_url
    if body.jenkins_console_url:
        dep.latest_jenkins_console_url = body.jenkins_console_url

    await dep.save()

    # Persist the stage transition + fan out on Kafka. Direct write (not
    # via the consumer) because we already have the DeploymentRequest in
    # hand and skipping the round-trip removes Kafka from the critical
    # path of the tracker view. Kafka event is fire-and-forget for
    # downstream consumers (dashboards, BI, on-call bots).
    stage_val = body.status
    state_val = (
        "failed"
        if body.status in _FAILURE_STATUSES
        else ("success" if body.status == "completed" else "started")
    )
    try:
        await DeploymentEvent(
            track_token=dep.track_token,
            submission_id=dep.submission_id,
            deployment_id=str(dep.id),
            slug=dep.repo_slug,
            env=body.env or (dep.environments[0] if dep.environments else ""),
            build_id=body.build_id or dep.latest_build_id,
            job_id=dep.latest_job_id,
            attempt=int(dep.attempt or 1),
            stage=stage_val,
            state=state_val,
            error=body.error,
            log_excerpt=body.log_excerpt,
            jenkins_build_url=body.jenkins_build_url,
            jenkins_console_url=body.jenkins_console_url,
        ).insert()
    except Exception as evt_exc:
        if "duplicate key" not in str(evt_exc).lower():
            traceback.print_exc()
    try:
        await kafka_events.publish_event(
            track_token=dep.track_token,
            submission_id=dep.submission_id,
            deployment_id=str(dep.id),
            slug=dep.repo_slug,
            env=body.env or (dep.environments[0] if dep.environments else ""),
            tag=None,
            stage=stage_val,
            state=state_val,
            attempt=int(dep.attempt or 1),
            build_id=dep.latest_build_id,
            job_id=dep.latest_job_id,
            error=body.error,
        )
    except Exception:
        pass

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


# ── Kafka stage-event consumer handler ─────────────────────────────────────
#
# Wired at boot in main.lifespan when PULSE_STAGE_TRANSPORT ∈ {kafka, dual}.
# Processes one message from pulse.deploy.events. Idempotent via the unique
# index on DeploymentEvent (track_token, build_id, stage, state) — kafka
# redeliveries land as no-ops after the first successful write.
_STAGE_TO_STATUS = {
    # Jenkins stage names → the internal per-env status vocab used by
    # env_statuses. When the mapping is missing we keep the raw stage as
    # the status (the tracker page renders it verbatim); the aggregate
    # worst-of stays sane because unknown values sort to 0.
    "building_image": "building_image",
    "pushing_manifest": "pushing_manifest",
    "cleaning_up": "cleaning_up",
    "completed": "completed",
    "failed": "failed",
    "failed_build": "failed_build",
    "failed_manifest": "failed_manifest",
}


async def handle_kafka_event(payload: dict) -> None:
    if payload.get("schema") != "pulse.deploy.event.v1":
        return
    track_token = payload.get("track_token")
    if not track_token:
        return

    # 1. Append immutable event row (idempotent via unique index).
    try:
        await DeploymentEvent(
            track_token=track_token,
            submission_id=payload.get("submission_id"),
            deployment_id=str(payload.get("deployment_id") or ""),
            slug=payload.get("slug") or "",
            env=payload.get("env") or "",
            build_id=payload.get("build_id"),
            job_id=payload.get("job_id"),
            attempt=int(payload.get("attempt") or 1),
            stage=payload.get("stage") or "",
            state=payload.get("state") or "",
            error=payload.get("error"),
            tag=payload.get("tag"),
        ).insert()
    except Exception as exc:  # duplicate key = redelivery, ignore
        if "duplicate key" not in str(exc).lower():
            traceback.print_exc()

    # 2. Advance DeploymentRequest.env_statuses. Only applies when the
    #    state is terminal-for-stage — a stage `started` event does not
    #    change env status (still building/pending).
    state = payload.get("state")
    if state not in ("success", "failed", "completed"):
        return
    stage = payload.get("stage") or ""
    status_val = _STAGE_TO_STATUS.get(stage, stage)
    if state == "failed":
        status_val = "failed_build" if stage == "building_image" else (
            "failed_manifest" if stage == "pushing_manifest" else "failed"
        )

    dep = await DeploymentRequest.find_one(
        DeploymentRequest.track_token == track_token
    )
    if not dep:
        return

    # Track the latest build_id/job_id for O(1) tracker reads.
    if payload.get("build_id"):
        dep.latest_build_id = str(payload["build_id"])
    if payload.get("job_id"):
        dep.latest_job_id = str(payload["job_id"])

    env = payload.get("env")
    if env and len(dep.environments) == 1 and dep.environments[0] == env:
        dep.status = status_val
        if state == "failed":
            dep.error = payload.get("error")
    elif env:
        env_statuses = dict(dep.env_statuses or {})
        env_errors = dict(dep.env_errors or {})
        env_statuses[env] = status_val
        if state == "failed" and payload.get("error"):
            env_errors[env] = payload["error"]
        dep.env_statuses = env_statuses
        dep.env_errors = env_errors
        dep.status = _aggregate_status(
            dep.environments, env_statuses, fallback=dep.status
        )

    await dep.save()


# ── Retry endpoint ────────────────────────────────────────────────────────
#
# POST /api/deployments/{deployment_id}/retry
# Bumps attempt, mints a fresh Kafka job_id, republishes the spec so
# Jenkins picks it up on the next claim. Reversible — same track_token,
# same tracker URL, timeline stacks the new attempt below the old one.
@router.post("/{deployment_id}/retry")
async def retry_deployment(
    deployment_id: str,
    admin: User = Depends(require_admin),
):
    dep = await DeploymentRequest.get(deployment_id)
    if not dep:
        raise HTTPException(status_code=404, detail="Deployment not found")
    # Guard: refuse retry while a build is mid-flight (avoid double claims).
    if dep.status in ("building_image", "pushing_manifest", "cleaning_up"):
        raise HTTPException(
            status_code=409,
            detail=f"Deployment is still in progress (status={dep.status}); wait or fail it first",
        )
    dep.attempt = int(dep.attempt or 1) + 1
    dep.status = "tags_pushed"
    dep.error = None
    # Clear the previous attempt's Jenkins snapshot so a stale kaniko
    # error from attempt N doesn't linger on the tracker page while
    # attempt N+1 is still queuing.
    dep.latest_log_excerpt = None
    dep.latest_jenkins_build_url = None
    dep.latest_jenkins_console_url = None
    dep.latest_build_id = None

    # Re-publish spec (in case it was pruned) and enqueue on both queues.
    try:
        spec = _build_jenkins_spec(dep)
        spec["trackToken"] = dep.track_token
        spec["submissionId"] = dep.submission_id
        spec["deploymentId"] = str(dep.id)
        spec["attempt"] = dep.attempt
        publish_spec(dep.repo_slug, spec)
        enqueue_job(
            dep.repo_slug,
            deployment_id=str(dep.id),
            requested_by=admin.email if hasattr(admin, "email") else str(admin),
        )
        env_for_job = dep.environments[0] if dep.environments else "staging"
        tag_for_job = (
            f"{dep.args.get('tag', 'v0.0.0')}"
            if isinstance(dep.args, dict)
            else "v0.0.0"
        )
        kafka_job_id = await kafka_events.enqueue_job(
            track_token=dep.track_token,
            submission_id=dep.submission_id,
            slug=dep.repo_slug,
            env=env_for_job,
            tag=tag_for_job,
            requested_by=dep.requested_by,
            deployment_id=str(dep.id),
        )
        dep.latest_job_id = kafka_job_id
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(
            status_code=502, detail=f"Retry enqueue failed: {exc}"
        )

    await dep.save()
    return {
        "matched": True,
        "deploymentId": str(dep.id),
        "attempt": dep.attempt,
        "latestJobId": dep.latest_job_id,
        "trackToken": dep.track_token,
    }
