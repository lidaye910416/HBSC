"""管理员登录与当前用户查询。"""
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel

from ..config import settings
from ..security import verify_password, create_access_token, get_current_admin
from ..middleware.rate_limit import consume_token_or_lock, is_bucket_locked

router = APIRouter(prefix="/api/auth", tags=["auth"])

# 登录后下发到 httpOnly cookie 的 token 名（前端无法读取）
ADMIN_TOKEN_COOKIE = "admin_token"

# 登录限流参数：失败 5 次锁 60 秒；成功路径不计 token。
_LOGIN_KEY = "auth.login"
_LOGIN_MAX_CALLS = 5
_LOGIN_WINDOW_SECONDS = 60


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
def login(req: LoginRequest, request: Request, response: Response):
    """管理员登录。同时下发 JWT 到 httpOnly cookie 与 JSON body。

    限流策略：失败校验消耗 1 个 token，成功校验不消耗。
    已被锁住的 bucket 在成功路径上仍返回 429（避免攻击者反复探测）。
    这样正确密码不会因前面几次手滑/慢输入被误锁。
    """
    if not settings.ADMIN_PASSWORD_HASH:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="管理员未初始化",
        )

    username_ok = req.username == settings.ADMIN_USERNAME
    password_ok = (
        verify_password(req.password, settings.ADMIN_PASSWORD_HASH)
        if username_ok
        else False
    )

    if not (username_ok and password_ok):
        # 失败路径：扣 token；bucket 已空则 429
        if not consume_token_or_lock(
            request,
            key=_LOGIN_KEY,
            max_calls=_LOGIN_MAX_CALLS,
            window_seconds=_LOGIN_WINDOW_SECONDS,
        ):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many failed login attempts, please wait",
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误",
        )

    # 成功路径：不扣 token，但若 bucket 被前序失败锁住仍返回 429
    if is_bucket_locked(
        request,
        key=_LOGIN_KEY,
        max_calls=_LOGIN_MAX_CALLS,
        window_seconds=_LOGIN_WINDOW_SECONDS,
    ):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed login attempts, please wait",
        )

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
