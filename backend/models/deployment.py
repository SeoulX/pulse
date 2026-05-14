import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional

from beanie import Document, Indexed
from pydantic import Field, field_validator


WorkloadKind = Literal["Deployment", "StatefulSet", "ScaledJob", "CronJob"]
DeploymentRole = Literal["API", "UI", "Worker", "Streamlit"]
Cluster = Literal["kl-1", "kl-2"]
Environment = Literal["staging", "production"]
Team = Literal["Backend", "Frontend", "DC/ML"]


def _new_token() -> str:
    return uuid.uuid4().hex


class DeploymentRequest(Document):
    repo_slug: Indexed(str) = Field(alias="repoSlug")
    repo_url: str = Field(alias="repoUrl")
    team: Team = "Backend"
    workload_kind: WorkloadKind = Field(alias="workloadKind")
    role: Optional[DeploymentRole] = None
    with_worker: bool = Field(default=False, alias="withWorker")
    cluster: Cluster = "kl-1"
    environments: List[Environment] = Field(default_factory=lambda: ["staging", "production"])
    env_vars: Dict[str, str] = Field(default_factory=dict, alias="envVars")
    domain_zone: str = Field(default="media-meter.in", alias="domainZone")
    domain: Optional[str] = None
    port: int = 8000
    args: Dict[str, str] = Field(default_factory=dict)
    hpa: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("env_vars", mode="before")
    @classmethod
    def _coerce_env_vars(cls, v: Any) -> Dict[str, str]:
        # Legacy docs stored env_vars as a single string. Migrate on read by
        # treating that block as the same value for whichever envs apply.
        if isinstance(v, str):
            return {"staging": v, "production": v} if v else {}
        return v or {}
    # Status vocab:
    #   pending_approval → awaiting DevOps
    #   approved         → DevOps OK'd; dry-run / dispatch runs next
    #   rejected         → DevOps said no (terminal)
    #   dry_run | webhook_added | tags_pushed | completed → post-approval stages
    #   failed           → post-approval error (terminal)
    status: str = "pending_approval"
    error: Optional[str] = None
    # Per-env pipeline status. Jenkins callbacks update env_statuses[env]; the
    # aggregate `status` above is recomputed as the worst-of (failures beat
    # non-terminal states beat completed) so a completed prod can't mask a
    # failed staging.
    env_statuses: Dict[str, str] = Field(default_factory=dict, alias="envStatuses")
    env_errors: Dict[str, str] = Field(default_factory=dict, alias="envErrors")
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
