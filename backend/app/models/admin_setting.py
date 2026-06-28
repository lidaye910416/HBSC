from sqlalchemy import Column, String, DateTime, Boolean
from sqlalchemy.sql import func
from .base import Base


class AdminSetting(Base):
    """Encrypted K/V store for admin-tunable settings (e.g. page-agent config)."""
    __tablename__ = "admin_settings"

    key = Column(String(100), primary_key=True)
    value_encrypted = Column(String(2000), nullable=False)  # Fernet token (base64)
    description = Column(String(500), nullable=False, default="")
    is_secret = Column(Boolean, nullable=False, default=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
    updated_by = Column(String(100), nullable=False, default="")

    def __repr__(self) -> str:
        return f"<AdminSetting {self.key}>"
