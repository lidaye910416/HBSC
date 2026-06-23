"""管理员登录与当前用户查询。"""
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..config import settings
from ..security import verify_password, create_access_token, get_current_admin

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: str


class MeResponse(BaseModel):
    username: str


@router.post("/login", response_model=TokenResponse)
def login(req: LoginRequest):
    """管理员登录。返回 JWT 与过期时间。"""
    if not settings.ADMIN_PASSWORD_HASH:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="管理员未初始化")
    if req.username != settings.ADMIN_USERNAME:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户名或密码错误")
    if not verify_password(req.password, settings.ADMIN_PASSWORD_HASH):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户名或密码错误")

    token = create_access_token(sub=req.username)
    expires_at = (datetime.now(timezone.utc) + timedelta(hours=settings.JWT_EXPIRE_HOURS)).isoformat()
    return TokenResponse(access_token=token, expires_at=expires_at)


@router.get("/me", response_model=MeResponse)
def me(username: str = Depends(get_current_admin)):
    """返回当前登录管理员用户名。"""
    return MeResponse(username=username)
