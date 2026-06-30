"""Fernet helpers for AdminSetting.value_encrypted."""
import os
import secrets
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken


class InvalidEncryptedValue(Exception):
    """Raised when decrypt_value gets a token that isn't valid Fernet ciphertext."""


def _load_or_generate_key() -> bytes:
    """Read ADMIN_SETTINGS_SECRET (44-char url-safe base64) from env.

    Priority:
      1. ``os.environ['ADMIN_SETTINGS_SECRET']`` — typical when the shell or
         a parent process already exported it.
      2. ``settings.ADMIN_SETTINGS_SECRET`` — picked up by pydantic-settings
         from `.env`. This is the common dev path: the user puts the key in
         `.env`, and crypto follows where pydantic-settings read from.
      3. Production (``ENV=production``): no key → raise.
      4. Dev fallback: ephemeral key — printed warning so it's obvious the
         admin rows are about to be unreadable across restarts.
    """
    import os as _os

    key = _os.getenv("ADMIN_SETTINGS_SECRET")
    if not key:
        # Pull from pydantic-settings (which reads .env). Import lazily so the
        # circular-import order doesn't matter — config.py is already
        # imported everywhere by the time crypto is used at request time.
        from ..config import settings as _settings
        key = getattr(_settings, "ADMIN_SETTINGS_SECRET", None)
    if key:
        return key.encode("utf-8")
    if _os.getenv("ENV") == "production":
        raise RuntimeError(
            "ADMIN_SETTINGS_SECRET must be set in production "
            "(44-char url-safe base64 Fernet key)"
        )
    # Dev fallback
    ephemeral = Fernet.generate_key()
    print(
        "[SECURITY][DEV ONLY] Using ephemeral ADMIN_SETTINGS_SECRET — "
        "settings will not survive restart.",
        flush=True,
    )
    return ephemeral


@lru_cache(maxsize=1)
def _cipher() -> Fernet:
    return Fernet(_load_or_generate_key())


def encrypt_value(plain: str) -> str:
    if plain is None:
        plain = ""
    return _cipher().encrypt(plain.encode("utf-8")).decode("ascii")


def decrypt_value(token: str) -> str:
    try:
        return _cipher().decrypt(token.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError) as e:
        raise InvalidEncryptedValue(str(e)) from e


def mask_value(plain: str) -> str:
    """Return a short masked view of a secret for display in admin UI."""
    if not plain:
        return ""
    if len(plain) <= 6:
        return "***"
    # Show first 4 and last 0 chars (typical key shape)
    return plain[:4] + "***"
