from fastapi import APIRouter, Depends, HTTPException, status

from api.deps import get_current_user
from core.security import create_access_token, hash_password, verify_password
from models.user import User
from schemas.auth import LoginRequest, RegisterRequest, RegisterResponse, TokenResponse, UserResponse

router = APIRouter(prefix="/auth", tags=["auth"])

# Shown on login when the account exists but hasn't been approved yet.
PENDING_MSG = "Your account is awaiting admin approval."
REJECTED_MSG = "Your registration was declined. Contact an administrator."


@router.post("/register", response_model=RegisterResponse, status_code=201)
async def register(body: RegisterRequest):
    """Self-signup. Creates a PENDING account that cannot log in until an
    admin approves it.

    The very first user is the bootstrap admin and is auto-approved —
    otherwise a fresh install would have nobody able to approve anyone.
    """
    user_count = await User.count()
    is_bootstrap = user_count == 0

    existing = await User.find_one(User.email == body.email.lower())
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    user = User(
        email=body.email.lower(),
        hashed_password=hash_password(body.password),
        role="admin" if is_bootstrap else "viewer",
        status="approved" if is_bootstrap else "pending",
    )
    await user.insert()

    return RegisterResponse(
        id=str(user.id),
        email=user.email,
        role=user.role,
        status=user.status,
        message=(
            "Account created. You can log in now."
            if is_bootstrap
            else "Account created and sent for approval. "
                 "An admin must approve it before you can log in."
        ),
    )


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest):
    user = await User.find_one(User.email == body.email.lower())
    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Credentials are valid but the account isn't cleared yet. 403 (not
    # 401) so the client can tell "wrong password" from "waiting on an
    # admin" and show the right message.
    if user.status == "pending":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=PENDING_MSG)
    if user.status == "rejected":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=REJECTED_MSG)

    token = create_access_token({"sub": str(user.id), "email": user.email, "role": user.role})
    return TokenResponse(access_token=token)


@router.get("/me", response_model=UserResponse)
async def me(user: User = Depends(get_current_user)):
    return UserResponse(id=str(user.id), email=user.email, role=user.role, status=user.status)
