from pydantic import BaseModel, EmailStr


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: str
    email: str
    role: str
    status: str = "approved"


class RegisterResponse(BaseModel):
    """Signup result. Carries `status` so the UI knows whether to log the
    user straight in (bootstrap admin) or show the awaiting-approval
    screen (everyone else)."""

    id: str
    email: str
    role: str
    status: str
    message: str
