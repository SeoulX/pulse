from datetime import datetime, timezone
from typing import Literal

from beanie import Document, Indexed
from pydantic import EmailStr, Field


class User(Document):
    email: Indexed(EmailStr, unique=True)
    hashed_password: str = Field(alias="hashedPassword")
    role: Literal["admin", "viewer"] = "viewer"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), alias="createdAt")

    class Settings:
        name = "users"
        use_state_management = True

    model_config = {"populate_by_name": True}
