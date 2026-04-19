import traceback

from fastapi import APIRouter, Depends, HTTPException

from api.deps import get_current_user, require_admin
from models.deployment import DeploymentRequest
from models.user import User
from schemas.deployment import CreateDeploymentRequest
from services.bitbucket import add_webhook, parse_repo_slug, push_tag

router = APIRouter(prefix="/deployments", tags=["deployments"])


def serialize(d: DeploymentRequest) -> dict:
    return {
        "_id": str(d.id),
        "repoSlug": d.repo_slug,
        "repoUrl": d.repo_url,
        "workloadKind": d.workload_kind,
        "status": d.status,
        "error": d.error,
        "requestedBy": d.requested_by,
        "createdAt": d.created_at.isoformat(),
    }


@router.get("")
async def list_deployments(user: User = Depends(get_current_user)):
    docs = await DeploymentRequest.find_all().sort("-createdAt").to_list()
    return [serialize(d) for d in docs]


@router.post("", status_code=201)
async def create_deployment(body: CreateDeploymentRequest, admin: User = Depends(require_admin)):
    try:
        slug = parse_repo_slug(body.repo_url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    dep = DeploymentRequest(
        repo_slug=slug,
        repo_url=body.repo_url,
        workload_kind=body.workload_kind,
        requested_by=admin.email,
    )
    await dep.insert()

    steps = []
    try:
        # 1. Add Jenkins webhook
        result = await add_webhook(slug)
        steps.append({"webhook": result})
        dep.status = "webhook_added"
        await dep.save()

        # 2. Push staging bootstrap tag
        result = await push_tag(slug, "v0.0.0-alpha")
        steps.append({"staging_tag": result})

        # 3. Push production bootstrap tag
        result = await push_tag(slug, "v0.0.0")
        steps.append({"production_tag": result})

        dep.status = "completed"
        await dep.save()

    except Exception as exc:
        traceback.print_exc()
        dep.status = "failed"
        dep.error = str(exc)
        await dep.save()
        raise HTTPException(status_code=502, detail=f"Deployment automation failed: {exc}")

    return {**serialize(dep), "steps": steps}
