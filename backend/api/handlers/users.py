from datetime import datetime, timezone

from beanie import PydanticObjectId
from fastapi import APIRouter, Depends, HTTPException

from api.deps import require_admin
from core.security import hash_password
from models.user import User
from schemas.user import CreateUserRequest, UpdateRoleRequest

router = APIRouter(prefix="/users", tags=["users"])


def _serialize(u: User) -> dict:
    return {
        "_id": str(u.id),
        "email": u.email,
        "role": u.role,
        "status": u.status,
        "approvedBy": u.approved_by,
        "approvedAt": u.approved_at.isoformat() if u.approved_at else None,
        "createdAt": u.created_at.isoformat(),
    }


@router.get("")
async def list_users(admin: User = Depends(require_admin)):
    users = await User.find_all().sort("-created_at").to_list()
    return [_serialize(u) for u in users]


@router.post("", status_code=201)
async def create_user(body: CreateUserRequest, admin: User = Depends(require_admin)):
    """Admin-created account — skips the approval queue, since an admin
    creating it IS the approval."""
    existing = await User.find_one(User.email == body.email.lower())
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    user = User(
        email=body.email.lower(),
        hashed_password=hash_password(body.password),
        role=body.role,
        status="approved",
        approved_by=admin.email,
        approved_at=datetime.now(timezone.utc),
    )
    await user.insert()
    return _serialize(user)


@router.post("/{user_id}/approve")
async def approve_user(user_id: str, admin: User = Depends(require_admin)):
    user = await User.get(PydanticObjectId(user_id))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.status = "approved"
    user.approved_by = admin.email
    user.approved_at = datetime.now(timezone.utc)
    await user.save()
    return _serialize(user)


@router.post("/{user_id}/reject")
async def reject_user(user_id: str, admin: User = Depends(require_admin)):
    """Decline a signup. Kept as a tombstone rather than deleted so the
    email stays claimed and can't simply re-register for another try."""
    if str(admin.id) == user_id:
        raise HTTPException(status_code=400, detail="Cannot reject your own account")

    user = await User.get(PydanticObjectId(user_id))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.status = "rejected"
    user.approved_by = admin.email
    user.approved_at = datetime.now(timezone.utc)
    await user.save()
    return _serialize(user)


@router.put("/{user_id}")
async def update_user_role(user_id: str, body: UpdateRoleRequest, admin: User = Depends(require_admin)):
    user = await User.get(PydanticObjectId(user_id))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.role = body.role
    await user.save()
    return _serialize(user)


@router.delete("/{user_id}", status_code=204)
async def delete_user(user_id: str, admin: User = Depends(require_admin)):
    if str(admin.id) == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")

    user = await User.get(PydanticObjectId(user_id))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    await user.delete()
