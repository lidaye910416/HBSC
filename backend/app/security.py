"""JWT + bcrypt helpers."""
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt

from .config import settings

# tokenUrl 仅用于 OpenAPI 文档，不强制实际路径
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


def hash_password(plain: str) -> str:
    """bcrypt 哈希密码（cost=12）。"""
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def create_access_token(sub: str, expires_hours: Optional[int] = None) -> str:
    """签发 JWT，sub=管理员用户名。"""
    hours = expires_hours if expires_hours is not None else settings.JWT_EXPIRE_HOURS
    expire = datetime.now(timezone.utc) + timedelta(hours=hours)
    payload = {"sub": sub, "exp": expire, "iat": datetime.now(timezone.utc)}
    return jwt.encode(payload, settings.effective_jwt_secret, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> dict:
    """解码 JWT。过期或签名错误抛 ValueError。"""
    try:
        return jwt.decode(token, settings.effective_jwt_secret, algorithms=[settings.JWT_ALGORITHM])
    except JWTError as e:
        raise ValueError(str(e)) from e


def get_current_admin(token: Optional[str] = Depends(oauth2_scheme)) -> str:
    """FastAPI 依赖：从 Authorization 头提取 JWT，返回管理员用户名。401 if 无效。"""
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="未认证")
    try:
        payload = decode_access_token(token)
        username = payload.get("sub")
        if not username:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="token 缺少 sub")
        return username
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="token 无效或已过期")