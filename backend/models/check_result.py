from datetime import datetime, timezone
from typing import Literal, Optional

from beanie import Document, PydanticObjectId
from pydantic import Field
from pymongo import IndexModel, ASCENDING, DESCENDING

from core.config import settings


class CheckResult(Document):
    endpoint_id: PydanticObjectId = Field(alias="endpointId")
    status: Literal["UP", "DOWN", "DEGRADED"]
    status_code: Optional[int] = Field(default=None, alias="statusCode")
    response_time: Optional[float] = Field(default=None, alias="responseTime")
    error: Optional[str] = None
    checked_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), alias="checkedAt")

    class Settings:
        name = "check_results"
        indexes = [
            IndexModel(
                [("endpointId", ASCENDING), ("checkedAt", DESCENDING)],
            ),
            IndexModel(
                [("checkedAt", ASCENDING)],
                expireAfterSeconds=settings.DATA_RETENTION_DAYS * 86400,
            ),
        ]

    model_config = {"populate_by_name": True}
