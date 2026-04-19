from typing import Literal, Optional

from pydantic import BaseModel


class CreateDeploymentRequest(BaseModel):
    repo_url: str
    workload_kind: Literal["Deployment", "StatefulSet", "ScaledJob", "CronJob"] = "Deployment"
