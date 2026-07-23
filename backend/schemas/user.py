from typing import Literal

from pydantic import BaseModel, EmailStr, Field


class UpdateRoleRequest(BaseModel):
    role: Literal["admin", "viewer"]


class CreateUserRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    role: Literal["admin", "viewer"] = "viewer"
