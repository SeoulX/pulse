from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request

from api.deps import require_admin
from core.config import settings
from models.check_result import CheckResult
from models.endpoint import Endpoint
from models.user import User
from services.check_endpoint import check_endpoint
from services.notification import process_notifications

router = APIRouter(prefix="/cron", tags=["cron"])


async def run_checks(endpoints: list[Endpoint]) -> dict:
    now = datetime.now(timezone.utc)

    due = []
    for ep in endpoints:
        if not ep.last_checked_at:
            due.append(ep)
        elif (now - ep.last_checked_at.replace(tzinfo=timezone.utc)).total_seconds() >= ep.interval:
            due.append(ep)

    checked = 0
    failed = 0

    for ep in due:
        try:
            result = await check_endpoint(ep)
            await CheckResult(endpoint_id=ep.id, **result).insert()

            ep.last_checked_at = now
            ep.last_status = result["status"]
            ep.last_response_time = result["response_time"]
            ep.total_checks += 1
            if result["status"] == "UP":
                ep.successful_checks += 1
                ep.consecutive_failures = 0
            else:
                ep.consecutive_failures += 1
            ep.uptime_percentage = round((ep.successful_checks / ep.total_checks) * 10000) / 100
            await ep.save()

            await process_notifications(ep, result)
            checked += 1
        except Exception:
            failed += 1

    return {"checked": checked, "failed": failed, "total": len(due), "timestamp": now.isoformat()}


@router.get("/check")
async def cron_check(request: Request):
    auth_header = request.headers.get("authorization", "")
    if auth_header != f"Bearer {settings.CRON_SECRET}":
        raise HTTPException(status_code=401, detail="Unauthorized")

    endpoints = await Endpoint.find(Endpoint.is_active == True).to_list()  # noqa: E712
    return await run_checks(endpoints)


@router.post("/trigger")
async def manual_trigger(admin: User = Depends(require_admin)):
    endpoints = await Endpoint.find(Endpoint.is_active == True).to_list()  # noqa: E712
    return await run_checks(endpoints)
