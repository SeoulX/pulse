import uuid
from datetime import datetime, timezone
from typing import List, Literal, Optional

from beanie import Document, Indexed
from pydantic import Field


WorkloadKind = Literal["Deployment", "StatefulSet", "ScaledJob", "CronJob"]
DeploymentRole = Literal["API", "UI", "Worker"]
Cluster = Literal["kl-1", "kl-2", "net3", "net4"]
Environment = Literal["staging", "production"]
Team = Literal["Backend", "Frontend", "DC", "ML"]


def _new_token() -> str:
    return uuid.uuid4().hex


class DeploymentRequest(Document):
    repo_slug: Indexed(str) = Field(alias="repoSlug")
    repo_url: str = Field(alias="repoUrl")
    team: Team = "Backend"
    workload_kind: WorkloadKind = Field(alias="workloadKind")
    role: Optional[DeploymentRole] = None
    cluster: Cluster = "kl-1"
    environments: List[Environment] = Field(default_factory=lambda: ["staging", "production"])
    # Status vocab:
    #   pending_approval → awaiting DevOps
    #   approved         → DevOps OK'd; dry-run / dispatch runs next
    #   rejected         → DevOps said no (terminal)
    #   dry_run | webhook_added | tags_pushed | completed → post-approval stages
    #   failed           → post-approval error (terminal)
    status: str = "pending_approval"
    error: Optional[str] = None
    requested_by: str = Field(alias="requestedBy")
    approved_by: Optional[str] = Field(default=None, alias="approvedBy")
    approved_at: Optional[datetime] = Field(default=None, alias="approvedAt")
    rejection_reason: Optional[str] = Field(default=None, alias="rejectionReason")
    track_token: Indexed(str) = Field(default_factory=_new_token, alias="trackToken")
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc), alias="createdAt"
    )

    class Settings:
        name = "deployment_requests"

    model_config = {"populate_by_name": True}
