from datetime import datetime, timezone

from beanie import PydanticObjectId
from fastapi import APIRouter, Depends, HTTPException, Query

from api.deps import get_current_user, require_admin
from models.check_result import CheckResult
from models.endpoint import Endpoint, Notifications, EmailNotification, DiscordNotification, WebhookNotification
from models.user import User
from schemas.endpoint import CreateEndpointRequest, UpdateEndpointRequest
from services.check_endpoint import check_endpoint

router = APIRouter(prefix="/endpoints", tags=["endpoints"])


def serialize_endpoint(ep: Endpoint) -> dict:
    notif = ep.notifications.model_dump(by_alias=True) if ep.notifications else {}
    return {
        "_id": str(ep.id),
        "projectId": str(ep.project_id) if ep.project_id else None,
        "name": ep.name,
        "url": ep.url,
        "method": ep.method,
        "expectedStatusCode": ep.expected_status_code,
        "interval": ep.interval,
        "timeout": ep.timeout,
        "headers": ep.headers,
        "body": ep.body,
        "isActive": ep.is_active,
        "alertEnabled": ep.alert_enabled,
        "alertThreshold": ep.alert_threshold,
        "consecutiveFailures": ep.consecutive_failures,
        "isAlerting": ep.is_alerting,
        "lastAlertedAt": ep.last_alerted_at.isoformat() if ep.last_alerted_at else None,
        "notifications": notif,
        "lastCheckedAt": ep.last_checked_at.isoformat() if ep.last_checked_at else None,
        "lastStatus": ep.last_status,
        "lastResponseTime": ep.last_response_time,
        "totalChecks": ep.total_checks,
        "successfulChecks": ep.successful_checks,
        "uptimePercentage": ep.uptime_percentage,
        "createdAt": ep.created_at.isoformat(),
        "updatedAt": ep.updated_at.isoformat(),
    }


@router.get("")
async def list_endpoints(
    project_id: str | None = Query(None, alias="projectId"),
    user: User = Depends(get_current_user),
):
    if project_id == "none":
        eps = await Endpoint.find(Endpoint.project_id == None).sort("-created_at").to_list()  # noqa: E711
    elif project_id:
        eps = await Endpoint.find(Endpoint.project_id == PydanticObjectId(project_id)).sort("-created_at").to_list()
    else:
        eps = await Endpoint.find_all().sort("-created_at").to_list()

    return [serialize_endpoint(ep) for ep in eps]


@router.post("", status_code=201)
async def create_endpoint(body: CreateEndpointRequest, admin: User = Depends(require_admin)):
    ep = Endpoint(
        project_id=PydanticObjectId(body.project_id) if body.project_id else None,
        name=body.name,
        url=body.url,
        method=body.method,
        expected_status_code=body.expected_status_code,
        interval=body.interval,
        timeout=body.timeout,
        headers=body.headers,
        body=body.body,
        is_active=body.is_active,
        alert_enabled=body.alert_enabled,
        alert_threshold=body.alert_threshold,
        notifications=Notifications(
            email=EmailNotification(**body.notifications.email.model_dump()),
            discord=DiscordNotification(**body.notifications.discord.model_dump()),
            webhook=WebhookNotification(**body.notifications.webhook.model_dump()),
        ),
    )
    await ep.insert()

    # Immediate first check
    result = await check_endpoint(ep)
    now = datetime.now(timezone.utc)

    await CheckResult(endpoint_id=ep.id, **result).insert()

    ep.last_checked_at = now
    ep.last_status = result["status"]
    ep.last_response_time = result["response_time"]
    ep.total_checks = 1
    ep.successful_checks = 1 if result["status"] == "UP" else 0
    ep.uptime_percentage = 100.0 if result["status"] == "UP" else 0.0
    ep.consecutive_failures = 0 if result["status"] == "UP" else 1
    await ep.save()

    return serialize_endpoint(ep)


@router.get("/{endpoint_id}")
async def get_endpoint(endpoint_id: str, user: User = Depends(get_current_user)):
    ep = await Endpoint.get(PydanticObjectId(endpoint_id))
    if not ep:
        raise HTTPException(status_code=404, detail="Endpoint not found")
    return serialize_endpoint(ep)


@router.put("/{endpoint_id}")
async def update_endpoint(endpoint_id: str, body: UpdateEndpointRequest, admin: User = Depends(require_admin)):
    ep = await Endpoint.get(PydanticObjectId(endpoint_id))
    if not ep:
        raise HTTPException(status_code=404, detail="Endpoint not found")

    update_data = body.model_dump(exclude_none=True)

    if "project_id" in update_data:
        val = update_data.pop("project_id")
        ep.project_id = PydanticObjectId(val) if val else None

    if "notifications" in update_data:
        notif = update_data.pop("notifications")
        ep.notifications = Notifications(
            email=EmailNotification(**notif.get("email", {})),
            discord=DiscordNotification(**notif.get("discord", {})),
            webhook=WebhookNotification(**notif.get("webhook", {})),
        )

    for key, val in update_data.items():
        setattr(ep, key, val)

    ep.updated_at = datetime.now(timezone.utc)
    await ep.save()
    return serialize_endpoint(ep)


@router.delete("/{endpoint_id}", status_code=204)
async def delete_endpoint(endpoint_id: str, admin: User = Depends(require_admin)):
    ep = await Endpoint.get(PydanticObjectId(endpoint_id))
    if not ep:
        raise HTTPException(status_code=404, detail="Endpoint not found")

    await ep.delete()
    await CheckResult.find(CheckResult.endpoint_id == PydanticObjectId(endpoint_id)).delete()


@router.get("/{endpoint_id}/history")
async def get_history(
    endpoint_id: str,
    limit: int = Query(100, le=1000),
    user: User = Depends(get_current_user),
):
    results = (
        await CheckResult.find(CheckResult.endpoint_id == PydanticObjectId(endpoint_id))
        .sort("-checked_at")
        .limit(limit)
        .to_list()
    )
    return [
        {
            "_id": str(r.id),
            "endpointId": str(r.endpoint_id),
            "status": r.status,
            "statusCode": r.status_code,
            "responseTime": r.response_time,
            "error": r.error,
            "checkedAt": r.checked_at.isoformat(),
        }
        for r in results
    ]
