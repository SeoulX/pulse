from typing import Literal

from pydantic import BaseModel


class UpdateRoleRequest(BaseModel):
    role: Literal["admin", "viewer"]
