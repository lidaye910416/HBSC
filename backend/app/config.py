import os
from pydantic import model_validator
from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    APP_NAME: str = "湖北数创 API"
    VERSION: str = "1.0.0"
    DEBUG: bool = True
    DATABASE_URL: str = "sqlite:///./research.db"

    # JWT（复用现有 SECRET_KEY，别名兼容旧名）
    # 无默认值；未设置时由 validator 注入临时 dev key 或在生产环境报错。
    SECRET_KEY: str = os.getenv("JWT_SECRET", "")
    JWT_SECRET: Optional[str] = None  # 如设置则覆盖 SECRET_KEY
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_HOURS: int = 8

    # 管理员凭据（生产环境必须通过 .env 注入）
    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD_HASH: str = ""  # bcrypt 哈希，空字符串=禁用登录

    # 上传
    UPLOAD_DIR: str = "./uploads"
    UPLOAD_MAX_SIZE_MB: int = 5
    UPLOAD_ALLOWED_MIMES: str = "image/png,image/jpeg,image/webp,image/gif"

    # AI 图像生成（minimax 平台；空 token 时使用占位图）
    MINIMAX_TOKEN: Optional[str] = None
    MINIMAX_API_URL: str = "https://api.minimax.chat/v1/image/generation"
    MINIMAX_MODEL: str = "image-01"

    ALLOWED_ORIGINS: list[str] = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:3000").split(",")

    class Config:
        env_file = ".env"

    @model_validator(mode="after")
    def _ensure_jwt_secret(self):
        if self.SECRET_KEY:
            return self
        if os.getenv("ENV") == "production":
            raise ValueError("JWT_SECRET must be set in production")
        import secrets
        self.SECRET_KEY = "dev-only-" + secrets.token_hex(16)
        print(f"[SECURITY] Using ephemeral dev SECRET_KEY")
        return self

    @property
    def effective_jwt_secret(self) -> str:
        return self.JWT_SECRET or self.SECRET_KEY


settings = Settings()
