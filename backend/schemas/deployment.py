from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, EmailStr, Field


WorkloadKind = Literal["Deployment", "StatefulSet", "ScaledJob", "CronJob"]
DeploymentRole = Literal["API", "UI", "Worker", "Streamlit"]
Cluster = Literal["kl-1", "kl-2"]
Environment = Literal["staging", "production"]
Team = Literal["Backend", "Frontend", "DC/ML"]


class CreateDeploymentRequest(BaseModel):
    repo_url: str
    requested_by: EmailStr
    team: Team
    workload_kind: WorkloadKind = "Deployment"
    role: Optional[DeploymentRole] = None
    # Companion worker for API role. When True with role=API, manifests scaffold
    # both server + worker pods (profile=api-worker). Ignored for non-API roles.
    with_worker: bool = False
    cluster: Cluster = "kl-1"
    environments: List[Environment] = Field(default_factory=lambda: ["staging", "production"])
    # Per-env free-form KEY=VALUE blocks. Each block is written as-is into
    # environments/<env>/config.properties by generate-manifests.sh.
    env_vars: Dict[Environment, str] = Field(default_factory=dict)
    # Route53 zone the app's DNS record lives under. external-dns in kl-1
    # reconciles records under whichever zone is selected.
    domain_zone: str = "media-meter.in"
    # Optional ingress domain. Defaults to `<slug>.<domain_zone>`. Staging
    # appends `-staging` to the leftmost label (e.g. `app-staging.<zone>`).
    domain: Optional[str] = None
    # Container port. Default 8000 (most APIs). UIs typically 3000, Streamlit 8501.
    port: int = 8000
    # Container args per child. Keys: "server", "worker". Empty/missing = image CMD.
    # Tokens split on whitespace by the bootstrap script (one arg per token).
    args: Dict[str, str] = Field(default_factory=dict)
    # HPA override (rarely used; form doesn't surface it). Per-env override:
    #   {"staging": {"min": 1, "max": 3, "target_cpu": 80},
    #    "production": {"min": 2, "max": 10, "target_cpu": 70}}
    # Empty = the per-env defaults in _build_jenkins_spec apply.
    hpa: Dict[str, Any] = Field(default_factory=dict)


class RejectDeploymentRequest(BaseModel):
    reason: Optional[str] = None


# Jenkins -> Pulse pipeline callback. Reports the phase the pipeline just
# finished (or failed at). Pulse matches to the most recent non-terminal
# deployment for the repo_slug and advances its status.
CallbackPhase = Literal[
    "image_built",       # kaniko push complete
    "manifest_pushed",   # Create Manifests stage finished; folder in manifests repo
    "completed",         # all pipeline work done
    "failed",            # pipeline errored at an unspecified stage
    "failed_build",      # kaniko stage failed
    "failed_manifest",   # Create Manifests stage failed
]


class PipelineCallback(BaseModel):
    status: CallbackPhase
    # Which env this callback reports on. Jenkins derives it from TAG_NAME
    # (alpha → staging, no suffix → production). Older builds may omit it;
    # the handler falls back to updating the legacy aggregate status only.
    env: Optional[Environment] = None
    error: Optional[str] = None
