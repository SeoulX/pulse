from fastapi import APIRouter, Depends

from api.deps import get_current_user
from models.endpoint import Endpoint
from models.notification import Notification
from models.user import User

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("")
async def list_notifications(user: User = Depends(get_current_user)):
    notifs = await Notification.find_all().sort("-sent_at").limit(50).to_list()

    # Manually populate endpoint info
    endpoint_ids = list({n.endpoint_id for n in notifs})
    endpoints = await Endpoint.find({"_id": {"$in": endpoint_ids}}).to_list()
    ep_map = {ep.id: ep for ep in endpoints}

    result = []
    for n in notifs:
        ep = ep_map.get(n.endpoint_id)
        result.append({
            "_id": str(n.id),
            "endpointId": str(n.endpoint_id),
            "endpoint": {"name": ep.name, "url": ep.url} if ep else None,
            "channel": n.channel,
            "type": n.type,
            "status": n.status,
            "message": n.message,
            "error": n.error,
            "sentAt": n.sent_at.isoformat(),
        })

    return result
