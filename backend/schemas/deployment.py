from typing import List, Literal, Optional

from pydantic import BaseModel, EmailStr, Field


WorkloadKind = Literal["Deployment", "StatefulSet", "ScaledJob", "CronJob"]
DeploymentRole = Literal["API", "UI", "Worker"]
Cluster = Literal["kl-1", "kl-2", "net3", "net4"]
Environment = Literal["staging", "production"]
Team = Literal["Backend", "Frontend", "DC", "ML"]


class CreateDeploymentRequest(BaseModel):
    repo_url: str
    requested_by: EmailStr
    team: Team
    workload_kind: WorkloadKind = "Deployment"
    role: Optional[DeploymentRole] = None
    cluster: Cluster = "kl-1"
    environments: List[Environment] = Field(default_factory=lambda: ["staging", "production"])


class RejectDeploymentRequest(BaseModel):
    reason: Optional[str] = None
