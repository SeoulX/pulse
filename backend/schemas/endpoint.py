from typing import Literal, Optional

from pydantic import BaseModel, Field


class EmailNotificationSchema(BaseModel):
    enabled: bool = False
    address: Optional[str] = None


class DiscordNotificationSchema(BaseModel):
    enabled: bool = False
    webhook_url: Optional[str] = None


class WebhookNotificationSchema(BaseModel):
    enabled: bool = False
    url: Optional[str] = None


class NotificationsSchema(BaseModel):
    email: EmailNotificationSchema = EmailNotificationSchema()
    discord: DiscordNotificationSchema = DiscordNotificationSchema()
    webhook: WebhookNotificationSchema = WebhookNotificationSchema()


class CreateEndpointRequest(BaseModel):
    project_id: Optional[str] = None
    name: str
    url: str
    method: Literal["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] = "GET"
    expected_status_code: int = 200
    interval: int = Field(default=60, ge=60, le=3600)
    timeout: int = Field(default=10, ge=1, le=60)
    headers: dict[str, str] = Field(default_factory=dict)
    body: str = ""
    is_active: bool = True
    alert_enabled: bool = False
    alert_threshold: int = 3
    notifications: NotificationsSchema = NotificationsSchema()


class UpdateEndpointRequest(BaseModel):
    project_id: Optional[str] = None
    name: Optional[str] = None
    url: Optional[str] = None
    method: Optional[Literal["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]] = None
    expected_status_code: Optional[int] = None
    interval: Optional[int] = Field(None, ge=60, le=3600)
    timeout: Optional[int] = Field(None, ge=1, le=60)
    headers: Optional[dict[str, str]] = None
    body: Optional[str] = None
    is_active: Optional[bool] = None
    alert_enabled: Optional[bool] = None
    alert_threshold: Optional[int] = None
    notifications: Optional[NotificationsSchema] = None
