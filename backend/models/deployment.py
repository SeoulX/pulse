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
    # SEV: a single form submit now creates N records (one per env). All N
    # share the same submission_id so the form's success card can list
    # sibling tracker URLs together, and admins can see the request as a
    # unit. Optional for backwards compat with pre-SEV multi-env records.
    submission_id: Optional[str] = Field(default=None, alias="submissionId")
    # ScaledJob workers (DC/ML scrapers, multi-queue layouts). Pulse
    # fetches devops/workers.yml from the customer's repo at submit time,
    # parses it via schemas/workers.py, and stores the parsed spec here.
    # Phase 2 will plumb this through to the manifest generator. None for
    # non-ScaledJob workloads or repos that don't have a workers.yml.
    workers: Optional[Dict[str, Any]] = Field(default=None)
    # Monorepo / polyworkload spec (devops/components.yml). Snapshotted at
    # submit time so the deploy is reproducible even if the dev edits
    # components.yml between submit and approve. Generator branches on
    # `image_target`:
    #   per-component → fan out to N flat manifest trees (Pattern A)
    #   shared        → emit N subtrees under one app (Pattern B, partial)
    # None when the repo has no components.yml.
    components: Optional[List[Dict[str, Any]]] = Field(default=None)
    image_target: Optional[str] = Field(default=None, alias="imageTarget")
    # Public ingress + TLS cert opt-out. None means "let the role decide
    # at generate-manifests.sh time" (the historical default). True/False
    # force the spec.needsIngress flag explicitly.
    needs_ingress: Optional[bool] = Field(default=None, alias="needsIngress")

    # Retry / build tracking. `attempt` is the count of Jenkins claims for
    # this env record (1 on first dispatch, ++ on every retry). `latest_*`
    # snapshot the most-recent run so the tracker page has O(1) access
    # without joining deployment_events. Full history lives in that
    # collection.
    attempt: int = 1
    latest_job_id: Optional[str] = None
    latest_build_id: Optional[str] = None

    # Request type. `new` (default) = the normal new-app submission flow.
    # `add_worker` = a follow-up request that appends a worker to an
    # existing scraper's devops/workers.yml + retags an alpha. Keeps
    # everything in one collection so the same tracker + Discord +
    # approval path covers both.
    kind: str = Field(default="new")
    # Set when kind="add_worker": {component, worker, max, batch, list_name?}.
    # None for kind="new". Approve flow reads this to patch workers.yml
    # and push the next alpha tag.
    add_worker_spec: Optional[Dict[str, Any]] = Field(
        default=None, alias="addWorkerSpec"
    )

    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc), alias="createdAt"
    )

    class Settings:
        name = "deployment_requests"

    model_config = {"populate_by_name": True}
