"""Admin settings (encrypted K/V)."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.admin_setting import AdminSetting
from ..schemas.admin_setting import AdminSettingOut, AdminSettingUpdate, SettingsListResponse
from ..security import get_current_admin
from ..services.crypto import encrypt_value, decrypt_value, mask_value


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
        updated_at=row.updated_at,
        updated_by=row.updated_by or "",
    )


@router.get("", response_model=SettingsListResponse)
def list_settings(
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    rows = db.query(AdminSetting).order_by(AdminSetting.key).all()
    return SettingsListResponse(items=[_to_out(r) for r in rows])


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
