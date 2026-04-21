import traceback
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from api.deps import require_admin
from core.config import settings
from models.deployment import DeploymentRequest
from models.user import User
from schemas.deployment import CreateDeploymentRequest, RejectDeploymentRequest
from services.bitbucket import (
    BOOTSTRAP_TAGS,
    add_webhook,
    classify_tags,
    delete_tag,
    list_tags,
    parse_repo_slug,
    push_tag,
)

router = APIRouter(prefix="/deployments", tags=["deployments"])


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
        print(
            f"[DEPLOYMENT DISPATCH] {dep.repo_slug} done — Jenkins should pick it up now",
            flush=True,
        )
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
