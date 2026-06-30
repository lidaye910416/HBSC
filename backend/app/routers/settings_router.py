"""Admin settings (encrypted K/V)."""
import logging
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
from ..services.llm_client import chat_complete, LLMUnavailable


router = APIRouter(prefix="/api/admin/settings", tags=["admin-settings"])

_log = logging.getLogger(__name__)


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


# ---- Connectivity probe (migrated from agent_router on 2026-06-30) -------
#
# Page-agent admin-side chat endpoints were removed; this connectivity probe
# stays useful for both ``page_agent.api_key`` and
# ``article_typesetter.api_key``. It lives in ``settings_router`` because the
# URL ``/api/admin/settings/{key}/test`` has always been administered via
# the settings UI.


def _get_setting(db: Session, key: str) -> Optional[str]:
    row = db.query(AdminSetting).filter_by(key=key).first()
    if not row:
        return None
    try:
        return decrypt_value(row.value_encrypted)
    except Exception:
        return None


def _get_or_default(db: Session, key: str) -> Optional[str]:
    val = _get_setting(db, key)
    if val is not None and val != "":
        return val
    d = default_for(key)
    if d is None or d == "":
        return None
    return d


# API keys that have a connectivity probe. Add new entries here rather than
# branching the body so each new key reuses the same ping logic below.
_TESTABLE_API_KEYS: dict[str, tuple[str, str]] = {
    # setting key → (default_base_url, default_model)
    "page_agent.api_key": (
        "https://api.deepseek.com/v1",
        "deepseek-v4-flash",
    ),
    "article_typesetter.api_key": (
        "https://api.minimaxi.com/v1",
        "MiniMax-M3",
    ),
}


@router.post("/{key:path}/test")
async def test_setting(
    key: str,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    """Connectivity probe for an LLM-style api_key setting."""
    if key not in _TESTABLE_API_KEYS:
        raise HTTPException(status_code=400, detail="该 key 暂不支持连通性测试")
    default_base_url, default_model = _TESTABLE_API_KEYS[key]
    prefix = key.split(".", 1)[0]  # "page_agent" or "article_typesetter"

    row = db.query(AdminSetting).filter_by(key=key).first()
    if not row:
        raise HTTPException(status_code=409, detail="未配置该 key")
    try:
        api_key = decrypt_value(row.value_encrypted)
    except Exception:
        raise HTTPException(status_code=409, detail="该 key 解密失败")
    if not api_key:
        raise HTTPException(status_code=409, detail="未配置该 key")

    base_url = (_get_or_default(db, f"{prefix}.base_url")) or default_base_url
    model = (_get_or_default(db, f"{prefix}.model")) or default_model

    try:
        sample = await chat_complete(
            base_url=base_url,
            api_key=api_key,
            model=model,
            messages=[{"role": "user", "content": "ping"}],
        )
    except LLMUnavailable as e:
        _log.warning("%s connectivity test failed: %s", key, e, exc_info=True)
        raise HTTPException(status_code=502, detail="连通性测试失败，请检查网络或 API Key")
    return {"ok": True, "sample": sample[:200]}
