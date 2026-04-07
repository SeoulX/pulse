from beanie import PydanticObjectId
from fastapi import APIRouter, Depends, Query

from api.deps import get_current_user
from models.endpoint import Endpoint
from models.user import User

router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("")
async def get_stats(
    project_id: str | None = Query(None, alias="projectId"),
    user: User = Depends(get_current_user),
):
    if project_id == "none":
        endpoints = await Endpoint.find(Endpoint.project_id == None).to_list()  # noqa: E711
    elif project_id:
        endpoints = await Endpoint.find(Endpoint.project_id == PydanticObjectId(project_id)).to_list()
    else:
        endpoints = await Endpoint.find_all().to_list()

    total = len(endpoints)
    up = sum(1 for e in endpoints if e.last_status == "UP")
    down = sum(1 for e in endpoints if e.last_status == "DOWN")
    degraded = sum(1 for e in endpoints if e.last_status == "DEGRADED")

    with_rt = [e for e in endpoints if e.last_response_time is not None]
    avg_response_time = round(sum(e.last_response_time for e in with_rt) / len(with_rt)) if with_rt else 0

    overall_uptime = (
        round(sum(e.uptime_percentage for e in endpoints) / total * 100) / 100
        if total > 0
        else 100
    )

    return {
        "total": total,
        "up": up,
        "down": down,
        "degraded": degraded,
        "avgResponseTime": avg_response_time,
        "overallUptime": overall_uptime,
    }
