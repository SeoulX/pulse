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
    # Whether the workload needs a public ingress + TLS cert. Defaults
    # depend on role (API/UI/Streamlit → true; Worker/ScaledJob/CronJob
    # → false) but the form can override either way. Stored unchanged
    # on the DeploymentRequest; the manifest generator reads
    # spec.needsIngress at bootstrap time.
    needs_ingress: Optional[bool] = None
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


class ApproveDeploymentRequest(BaseModel):
    """Optional body for the approve endpoint. Admins can overwrite the dev's
    env_vars at approve-time — DevOps holds the real connection strings, so it's
    common for the form submission to ship placeholders that need replacing
    before Jenkins fetches the spec.
    """
    env_vars: Optional[Dict[Environment, str]] = None


# Jenkins -> Pulse pipeline callback. Reports the phase the pipeline is
# CURRENTLY doing (new step-by-step model) or just finished (legacy).
# Pulse matches to the most recent non-terminal deployment for the
# repo_slug and advances its status.
CallbackPhase = Literal[
    # In-progress statuses — fired at the START of each stage so Pulse's UI
    # mirrors Jenkins's stage view in real time.
    "building_image",    # kaniko running right now
    "pushing_manifest",  # manifest gen + git push running right now
    "cleaning_up",       # workspace wipe + notify hooks running right now
    # Legacy "X just finished" statuses — older Jenkinsfile versions and
    # pre-existing records use these. Kept for backwards compat.
    "image_built",
    "manifest_pushed",
    # Terminal success — fired AFTER finally so Jenkins is truly done.
    "completed",
    # Terminal failures.
    "failed",
    "failed_build",
    "failed_manifest",
]


class PipelineCallback(BaseModel):
    status: CallbackPhase
    # Which env this callback reports on. Jenkins derives it from TAG_NAME
    # (alpha → staging, no suffix → production). Older builds may omit it;
    # the handler falls back to updating the legacy aggregate status only.
    env: Optional[Environment] = None
    error: Optional[str] = None
