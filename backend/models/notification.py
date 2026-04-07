from datetime import datetime, timezone
from typing import Literal, Optional

from beanie import Document, PydanticObjectId
from pydantic import Field
from pymongo import IndexModel, DESCENDING


class Notification(Document):
    endpoint_id: PydanticObjectId = Field(alias="endpointId")
    channel: Literal["email", "discord", "webhook"]
    type: Literal["alert", "recovery"]
    status: Literal["sent", "failed"]
    message: str = ""
    error: Optional[str] = None
    sent_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), alias="sentAt")

    class Settings:
        name = "notifications"
        indexes = [
            IndexModel([("sentAt", DESCENDING)]),
        ]

    model_config = {"populate_by_name": True}
