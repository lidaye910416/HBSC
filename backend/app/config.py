import os
from pydantic import model_validator
from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    APP_NAME: str = "湖北数创 API"
    VERSION: str = "1.0.0"
    DEBUG: bool = os.getenv("DEBUG", "false").lower() == "true"
    DATABASE_URL: str = "sqlite:///./research.db"

    # JWT（复用现有 SECRET_KEY，别名兼容旧名）
    # 无默认值；未设置时由 validator 注入临时 dev key 或在生产环境报错。
    SECRET_KEY: str = os.getenv("JWT_SECRET", "")
    JWT_SECRET: Optional[str] = None  # 如设置则覆盖 SECRET_KEY
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_HOURS: int = 8

    # 管理员凭据（生产环境必须通过 .env 注入；空=禁用登录）
    # 未设置时由 validator 在非生产环境注入 dev 默认值；生产环境报错。
    ADMIN_USERNAME: str = os.getenv("ADMIN_USERNAME", "")
    ADMIN_PASSWORD_HASH: str = os.getenv("ADMIN_PASSWORD_HASH", "")

    # 上传
    UPLOAD_DIR: str = "./uploads"
    UPLOAD_MAX_SIZE_MB: int = 5
    UPLOAD_ALLOWED_MIMES: str = "image/png,image/jpeg,image/webp,image/gif"

    # 加密 AdminSetting 行用的 Fernet key。生产环境必须设置；dev 未设置时
    # _load_or_generate_key 会生成一次性 key 并发出警告（这些加密过的行将不会
    # 跨进程存活 — 适合本机开发；切勿用于生产）。
    ADMIN_SETTINGS_SECRET: Optional[str] = None

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

    @model_validator(mode="after")
    def _ensure_admin_credentials(self):
        """生产环境必须显式注入 ADMIN_USERNAME / ADMIN_PASSWORD_HASH。
        非生产环境允许 dev 便利默认值，但会在 stderr 打印警告以提醒。"""
        is_prod = os.getenv("ENV") == "production"
        if not self.ADMIN_USERNAME or not self.ADMIN_PASSWORD_HASH:
            if is_prod:
                raise ValueError(
                    "ADMIN_USERNAME and ADMIN_PASSWORD_HASH must be set in production"
                )
            # 开发/测试环境：注入默认 dev 凭据 + 明确警告
            import secrets as _sec
            if not self.ADMIN_USERNAME:
                self.ADMIN_USERNAME = "admin"
            if not self.ADMIN_PASSWORD_HASH:
                from .security import hash_password
                dev_password = "dev-" + _sec.token_hex(8)
                self.ADMIN_PASSWORD_HASH = hash_password(dev_password)
                print(
                    f"[SECURITY][DEV ONLY] Using ephemeral admin credentials — "
                    f"username='{self.ADMIN_USERNAME}' password='{dev_password}'",
                    flush=True,
                )
        return self

    @property
    def effective_jwt_secret(self) -> str:
        return self.JWT_SECRET or self.SECRET_KEY


settings = Settings()
