from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class AdminSettingOut(BaseModel):
    """Single setting row returned to admin UI. Secret values are masked.

    ``default_value`` carries the preset default (e.g. minimax config for
    ``article_typesetter.*``) so the UI can show "what would apply if you
    haven't saved anything yet". It's never the decrypted secret.
    """
    key: str
    value: Optional[str]      # decrypted plain value, or None if masking applied
    masked: Optional[str]     # short masked preview when value is secret
    is_secret: bool
    description: str
    default_value: Optional[str] = None
    updated_at: Optional[datetime] = None  # None when no DB row exists
    updated_by: Optional[str] = None       # "" (or None) when synthesized

    class Config:
        from_attributes = True


class AdminSettingUpdate(BaseModel):
    """Update payload — value is required; admin username stamped from JWT."""
    value: str
    description: Optional[str] = None


class SettingsListResponse(BaseModel):
    items: list[AdminSettingOut]
