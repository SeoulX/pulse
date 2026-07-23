from datetime import datetime, timezone
from typing import Literal, Optional

from beanie import Document, Indexed
from pydantic import EmailStr, Field

# Registration gate. Self-signup lands in "pending" and cannot log in
# until an admin approves it; "rejected" is a tombstone that keeps the
# email claimed so the same address can't re-register for another shot
# at the queue.
#
# Default is "approved" ON PURPOSE: users created before this field
# existed have no `status` key in mongo, and Beanie fills the default on
# read. Defaulting to "pending" would silently lock out every existing
# account. New self-signups set "pending" explicitly.
UserStatus = Literal["pending", "approved", "rejected"]


class User(Document):
    email: Indexed(EmailStr, unique=True)
    hashed_password: str = Field(alias="hashedPassword")
    role: Literal["admin", "viewer"] = "viewer"
    status: UserStatus = "approved"
    # Audit trail for the approval decision.
    approved_by: Optional[str] = Field(default=None, alias="approvedBy")
    approved_at: Optional[datetime] = Field(default=None, alias="approvedAt")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), alias="createdAt")

    class Settings:
        name = "users"
        use_state_management = True

    model_config = {"populate_by_name": True}
