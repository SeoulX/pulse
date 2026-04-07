from beanie import PydanticObjectId
from fastapi import APIRouter, Depends, HTTPException

from api.deps import require_admin
from models.user import User
from schemas.user import UpdateRoleRequest

router = APIRouter(prefix="/users", tags=["users"])


@router.get("")
async def list_users(admin: User = Depends(require_admin)):
    users = await User.find_all().sort("-created_at").to_list()
    return [
        {"_id": str(u.id), "email": u.email, "role": u.role, "createdAt": u.created_at.isoformat()}
        for u in users
    ]


@router.put("/{user_id}")
async def update_user_role(user_id: str, body: UpdateRoleRequest, admin: User = Depends(require_admin)):
    user = await User.get(PydanticObjectId(user_id))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.role = body.role
    await user.save()
    return {"_id": str(user.id), "email": user.email, "role": user.role, "createdAt": user.created_at.isoformat()}


@router.delete("/{user_id}", status_code=204)
async def delete_user(user_id: str, admin: User = Depends(require_admin)):
    if str(admin.id) == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")

    user = await User.get(PydanticObjectId(user_id))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    await user.delete()
