from datetime import datetime, timezone

from beanie import Document, Indexed
from pydantic import Field


class Project(Document):
    name: Indexed(str, unique=True)
    color: str = "#e8871e"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), alias="createdAt")
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), alias="updatedAt")

    class Settings:
        name = "projects"

    model_config = {"populate_by_name": True}
