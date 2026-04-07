from typing import Optional

from pydantic import BaseModel, Field


class CreateProjectRequest(BaseModel):
    name: str = Field(..., max_length=100)
    color: Optional[str] = "#e8871e"


class UpdateProjectRequest(BaseModel):
    name: Optional[str] = Field(None, max_length=100)
    color: Optional[str] = None
