from fastapi import APIRouter, Depends, HTTPException, status

from api.deps import get_current_user
from core.security import create_access_token, hash_password, verify_password
from models.user import User
from schemas.auth import LoginRequest, RegisterRequest, TokenResponse, UserResponse

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=UserResponse, status_code=201)
async def register(body: RegisterRequest):
    user_count = await User.count()

    if user_count > 0:
        # For now, open registration but subsequent users become viewers.
        # Admin promotion is done via PUT /users/{id}
        pass

    existing = await User.find_one(User.email == body.email.lower())
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    user = User(
        email=body.email.lower(),
        hashed_password=hash_password(body.password),
        role="admin" if user_count == 0 else "viewer",
    )
    await user.insert()

    return UserResponse(id=str(user.id), email=user.email, role=user.role)


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest):
    user = await User.find_one(User.email == body.email.lower())
    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_access_token({"sub": str(user.id), "email": user.email, "role": user.role})
    return TokenResponse(access_token=token)


@router.get("/me", response_model=UserResponse)
async def me(user: User = Depends(get_current_user)):
    return UserResponse(id=str(user.id), email=user.email, role=user.role)
