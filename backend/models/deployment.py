from datetime import datetime, timezone
from typing import Literal, Optional

from beanie import Document, Indexed
from pydantic import Field


WorkloadKind = Literal["Deployment", "StatefulSet", "ScaledJob", "CronJob"]


class DeploymentRequest(Document):
    repo_slug: Indexed(str) = Field(alias="repoSlug")
    repo_url: str = Field(alias="repoUrl")
    workload_kind: WorkloadKind = Field(alias="workloadKind")
    status: str = "pending"  # pending, webhook_added, tags_pushed, completed, failed
    error: Optional[str] = None
    requested_by: str = Field(alias="requestedBy")
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc), alias="createdAt"
    )

    class Settings:
        name = "deployment_requests"

    model_config = {"populate_by_name": True}
