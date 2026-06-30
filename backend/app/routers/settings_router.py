"""Admin settings (encrypted K/V)."""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.admin_setting import AdminSetting
from ..schemas.admin_setting import AdminSettingOut, AdminSettingUpdate, SettingsListResponse
from ..security import get_current_admin
from ..services.crypto import encrypt_value, decrypt_value, mask_value
from ..services.admin_setting_defaults import (
    KNOWN_KEYS_DEFAULTS,
    default_for,
)


router = APIRouter(prefix="/api/admin/settings", tags=["admin-settings"])


# Keys that must be encrypted + masked. Anything ending in api_key / token / secret.
_SECRET_SUFFIXES = ("api_key", "token", "secret")


def _is_secret_key(key: str) -> bool:
    return any(key.endswith(s) for s in _SECRET_SUFFIXES)


def _to_out(row: AdminSetting) -> AdminSettingOut:
    plain: Optional[str] = None
    masked: Optional[str] = None
    try:
        plain = decrypt_value(row.value_encrypted)
    except Exception:
        plain = None
    if row.is_secret:
        masked = mask_value(plain or "")
        plain = None
    return AdminSettingOut(
        key=row.key,
        value=plain,
        masked=masked,
        is_secret=row.is_secret,
        description=row.description or "",
        default_value=_resolved_default(row.key, row.is_secret),
        updated_at=row.updated_at,
        updated_by=row.updated_by or "",
    )


def _resolved_default(key: str, is_secret_in_db: bool) -> Optional[str]:
    """Default value for the UI to show in the input or as placeholder.

    ``is_secret`` defaults are never surfaced via ``default_value`` — the
    api_key field has no usable default and the browser must always prompt
    for the secret.
    """
    if _is_secret_key(key):
        return None
    d = default_for(key)
    if d is None or d == "":
        return None
    # Truncate the system_prompt default for the list view; the UI calls
    # /api/admin/settings/{key} or fetches the row detail if it needs the
    # full text. We send enough for the placeholder to be meaningful.
    if key.endswith("system_prompt") and len(d) > 80:
        return d[:77] + "…"
    return d


def _synthetic_row(key: str) -> AdminSettingOut:
    """Build an AdminSettingOut for a key with no DB row but a preset default."""
    default = default_for(key) or ""
    is_secret = _is_secret_key(key)
    out = AdminSettingOut(
        key=key,
        value=None,            # no DB row → no actual value yet
        masked=mask_value(default) if is_secret and default else None,
        is_secret=is_secret,
        description="",
        default_value=_resolved_default(key, is_secret),
        updated_at=None,
        updated_by=None,
    )
    # For non-secret synthesized rows, expose the default in `value` too so
    # the form initialValue matches what the system would actually use.
    if not is_secret and default:
        out.value = default
    return out


@router.get("", response_model=SettingsListResponse)
def list_settings(
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    """List every AdminSetting row plus synthesized preset defaults for
    known keys the admin hasn't customized yet."""
    rows = db.query(AdminSetting).order_by(AdminSetting.key).all()
    existing_keys = {r.key for r in rows}

    items: list[AdminSettingOut] = [_to_out(r) for r in rows]

    # Synthesize missing preset rows so the UI can show defaults in one pass.
    for key in KNOWN_KEYS_DEFAULTS:
        if key not in existing_keys:
            items.append(_synthetic_row(key))

    items.sort(key=lambda x: x.key)
    return SettingsListResponse(items=items)


@router.put("/{key}", response_model=AdminSettingOut)
def upsert_setting(
    key: str,
    body: AdminSettingUpdate,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    if not key or len(key) > 100:
        raise HTTPException(status_code=400, detail="key 长度需在 1-100 字符之间")
    is_secret = _is_secret_key(key)
    row = db.query(AdminSetting).filter(AdminSetting.key == key).first()
    if row is None:
        row = AdminSetting(
            key=key,
            value_encrypted=encrypt_value(body.value),
            description=body.description or "",
            is_secret=is_secret,
            updated_by=admin,
        )
        db.add(row)
    else:
        row.value_encrypted = encrypt_value(body.value)
        if body.description is not None:
            row.description = body.description
        row.is_secret = is_secret
        row.updated_by = admin
    db.commit()
    db.refresh(row)
    return _to_out(row)
