from datetime import datetime, timezone
from typing import Literal, Optional

from beanie import Document, PydanticObjectId
from pydantic import BaseModel, Field


class EmailNotification(BaseModel):
    enabled: bool = False
    address: Optional[str] = None


class DiscordNotification(BaseModel):
    enabled: bool = False
    webhook_url: Optional[str] = Field(default=None, alias="webhookUrl")

    model_config = {"populate_by_name": True}


class WebhookNotification(BaseModel):
    enabled: bool = False
    url: Optional[str] = None


class Notifications(BaseModel):
    email: EmailNotification = EmailNotification()
    discord: DiscordNotification = DiscordNotification()
    webhook: WebhookNotification = WebhookNotification()


class Endpoint(Document):
    project_id: Optional[PydanticObjectId] = Field(default=None, alias="projectId")
    name: str
    url: str
    method: Literal["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] = "GET"
    expected_status_code: int = Field(default=200, alias="expectedStatusCode")
    interval: int = Field(default=60, ge=60, le=3600)
    timeout: int = Field(default=10, ge=1, le=60)
    headers: dict[str, str] = Field(default_factory=dict)
    body: str = ""
    is_active: bool = Field(default=True, alias="isActive")

    alert_enabled: bool = Field(default=False, alias="alertEnabled")
    alert_threshold: int = Field(default=3, alias="alertThreshold")
    consecutive_failures: int = Field(default=0, alias="consecutiveFailures")
    is_alerting: bool = Field(default=False, alias="isAlerting")
    last_alerted_at: Optional[datetime] = Field(default=None, alias="lastAlertedAt")

    notifications: Notifications = Notifications()

    last_checked_at: Optional[datetime] = Field(default=None, alias="lastCheckedAt")
    last_status: Optional[Literal["UP", "DOWN", "DEGRADED"]] = Field(default=None, alias="lastStatus")
    last_response_time: Optional[float] = Field(default=None, alias="lastResponseTime")
    total_checks: int = Field(default=0, alias="totalChecks")
    successful_checks: int = Field(default=0, alias="successfulChecks")
    uptime_percentage: float = Field(default=100.0, alias="uptimePercentage")

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), alias="createdAt")
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), alias="updatedAt")

    class Settings:
        name = "endpoints"

    model_config = {"populate_by_name": True}
