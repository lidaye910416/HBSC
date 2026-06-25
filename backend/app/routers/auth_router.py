"""管理员登录与当前用户查询。"""
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel

from ..config import settings
from ..security import verify_password, create_access_token, get_current_admin
from ..middleware.rate_limit import rate_limit

router = APIRouter(prefix="/api/auth", tags=["auth"])

# 登录后下发到 httpOnly cookie 的 token 名（前端无法读取）
ADMIN_TOKEN_COOKIE = "admin_token"


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
@rate_limit(max_calls=5, window_seconds=60)
def login(req: LoginRequest, request: Request, response: Response):
    """管理员登录。同时下发 JWT 到 httpOnly cookie 与 JSON body。"""
    if not settings.ADMIN_PASSWORD_HASH:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="管理员未初始化")
    if req.username != settings.ADMIN_USERNAME:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户名或密码错误")
    if not verify_password(req.password, settings.ADMIN_PASSWORD_HASH):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户名或密码错误")

    token = create_access_token(sub=req.username)
    expires_at_dt = datetime.now(timezone.utc) + timedelta(hours=settings.JWT_EXPIRE_HOURS)
    expires_at = expires_at_dt.isoformat()

    # 下发到 httpOnly cookie（8 小时，与 JWT 过期一致）
    response.set_cookie(
        key=ADMIN_TOKEN_COOKIE,
        value=token,
        httponly=True,
        secure=False,  # 生产环境通过环境变量置 True
        samesite="strict",
        max_age=settings.JWT_EXPIRE_HOURS * 60 * 60,
        path="/",
    )

    return TokenResponse(access_token=token, expires_at=expires_at)


@router.post("/logout")
def logout(response: Response):
    """注销：清除 httpOnly cookie。"""
    response.delete_cookie(ADMIN_TOKEN_COOKIE, path="/")
    return {"ok": True}


@router.get("/me", response_model=MeResponse)
def me(username: str = Depends(get_current_admin)):
    """返回当前登录管理员用户名。"""
    return MeResponse(username=username)
