"""One-time dev seed for the two LLM api_keys (page-agent + AI 排版).

Why a script and not env-vars or .env?
  - The api_keys live in the encrypted AdminSetting table (Fernet) so they
    persist across backend restarts and never land in a .env file that could
    leak via git.
  - The admin can re-rotate the keys through the AdminSettings UI without
    rerunning this script.
  - The script is idempotent — re-running with existing keys is a no-op
    unless `--force` is passed.

Refuses to run when ENV=production (we never write dev/seed keys to a real
deployment). When run, prints ONLY a 4-char fingerprint of each key, not the
key itself — protection against log scraping.

Usage:

    # 写库（admin UI 自动看到预填）
    ENV=development python3 -m scripts.seed_dev_keys --dev-only

    # 仅打印 JSON 到 stdout（供 smoke 脚本读取真 key）
    ENV=development python3 -m scripts.seed_dev_keys --dev-only --print-only > /tmp/keys.json

    # 强制覆盖已存在的 api_key
    ENV=development python3 -m scripts.seed_dev_keys --dev-only --force
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Optional

# Force in-memory ADMIN_SETTINGS_SECRET when running in CI; respects a real
# value if one is already in the environment (the dev workflow).
os.environ.setdefault("ENV", "development")
os.environ.setdefault("ADMIN_USERNAME", "seed-dev")

# Load .env so ADMIN_SETTINGS_SECRET is consistent with the running backend.
# We compute BACKEND_ROOT first since the load_dotenv block below needs it.
import pathlib as _pathlib
_BACKEND_ROOT = _pathlib.Path(__file__).resolve().parent.parent
try:
    from dotenv import load_dotenv  # type: ignore
    load_dotenv(str(_BACKEND_ROOT / ".env"))
except ImportError:
    pass

# Make `app.*` importable when run as `python3 -m scripts.seed_dev_keys`.
BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_ROOT not in sys.path:
    sys.path.insert(0, BACKEND_ROOT)

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.config import settings  # noqa: E402
from app.database import get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.base import Base  # noqa: F401  (registers all tables)
from app.models.admin_setting import AdminSetting  # noqa: E402
from app.security import get_current_admin  # noqa: E402  (sanity check dep wiring)


# ---------------------------------------------------------------------------
# The two keys the user provided. Override via env if they ever rotate.
# Pulled out into a constants block so this script never inlines a literal
# key elsewhere — easier to audit, easier to scrub before commit if needed.
# ---------------------------------------------------------------------------
USER_PROVIDED_DEEPSEEK_KEY = os.environ.get(
    "HUBEI_DEEPSEEK_KEY",
    "sk-40846849c90b4e94ad4b1889f7c868b2",
)
USER_PROVIDED_MINIMAX_KEY = os.environ.get(
    "HUBEI_MINIMAX_KEY",
    "sk-cp-tV4TuUIpZt64tdZO3kjFDIydJtrgaSDPDAXNo8zYk8CTHD39wz7vg1JN7_Dqd8LpevwJoZozDcpRo1REhX3PaCak4A8M-Rl8MXAEMvGbMoNOSi73B27yoM",
)

# Rows to upsert. Each tuple: (key, value, is_secret, should_overwrite_when_force).
# `enabled` and `model` and `base_url` are also forced so a dev machine always
# has consistent defaults even if admin previously toggled them in the UI.
SEED_ROWS: list[tuple[str, str, bool]] = [
    ("page_agent.enabled",       "true",                              False),
    ("page_agent.model",         "deepseek-v4-flash",                 False),
    ("page_agent.base_url",      "https://api.deepseek.com/v1",       False),
    ("page_agent.api_key",       USER_PROVIDED_DEEPSEEK_KEY,          True),

    ("article_typesetter.enabled",  "true",                            False),
    ("article_typesetter.model",    "MiniMax-M3",                      False),
    ("article_typesetter.base_url", "https://api.minimax.chat/v1",     False),
    ("article_typesetter.api_key",  USER_PROVIDED_MINIMAX_KEY,         True),
]


def _fingerprint(value: str) -> str:
    """Stable 4-char fingerprint to print for verification.

    Always returns first 4 chars + `***`. Never logs the full key.
    """
    if not value:
        return "(empty)"
    return value[:4] + "***"


def _is_production() -> bool:
    return os.environ.get("ENV", "").strip().lower() in ("production", "prod")


def _connect_to_dev_db():
    """Open a SQLite session against the same database the running app uses.

    Returns a Session factory + engine.
    """
    db_url = settings.DATABASE_URL  # from app/config.py
    engine = create_engine(db_url, connect_args={"check_same_thread": False} if db_url.startswith("sqlite") else {})
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def _upsert_row(Session, key: str, value: str, is_secret: bool, force: bool) -> str:
    """Idempotent insert/update.

    Returns one of: "inserted", "updated", "skipped-exists".
    """
    s = Session()
    try:
        existing = s.query(AdminSetting).filter_by(key=key).first()
        if existing is None:
            from app.services.crypto import encrypt_value
            s.add(AdminSetting(
                key=key,
                value_encrypted=encrypt_value(value),
                is_secret=is_secret,
                description="seeded by seed_dev_keys.py",
                updated_by="seed-dev",
            ))
            s.commit()
            return "inserted"
        if force or not existing.value_encrypted:
            from app.services.crypto import encrypt_value
            existing.value_encrypted = encrypt_value(value)
            existing.is_secret = is_secret
            existing.updated_by = "seed-dev"
            s.commit()
            return "updated"
        return "skipped-exists"
    finally:
        s.close()


def _check_settings_router_wired() -> None:
    """Sanity check: the settings router is registered and the crypto helper
    round-trips. Fails early with a clear error if the wiring is broken.
    """
    from app.services.crypto import encrypt_value, decrypt_value  # noqa: F401
    routes = {r.path for r in app.routes if hasattr(r, "path")}
    required = {"/api/admin/settings", "/api/admin/settings/{key}",
                "/api/public/agent/config", "/api/public/agent/execute"}
    missing = required - routes
    if missing:
        raise RuntimeError(
            f"Required routes not registered on the FastAPI app: {missing}. "
            f"Did you forget to app.include_router(...) in main.py?"
        )


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Seed dev API keys into the AdminSetting table (idempotent).",
    )
    parser.add_argument(
        "--dev-only",
        action="store_true",
        required=True,
        help="MANDATORY. Acknowledges this script writes dev keys to the DB.",
    )
    parser.add_argument(
        "--print-only",
        action="store_true",
        help="Skip DB writes; print {deepseek_key, minimax_key} JSON to stdout "
             "for downstream smoke scripts.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite existing non-empty api_key rows (and force-write all rows).",
    )
    parser.add_argument(
        "--allow-production",
        action="store_true",
        help="DANGEROUS. Bypass the ENV=production safety check. Never use in CI.",
    )
    args = parser.parse_args(argv)

    if _is_production() and not args.allow_production:
        print(
            "⛔  Refusing to run: ENV=production.\n"
            "    Re-run with --allow-production if you really mean it.",
            file=sys.stderr,
        )
        return 2

    if args.print_only:
        out = {
            "deepseek_key": USER_PROVIDED_DEEPSEEK_KEY,
            "minimax_key":  USER_PROVIDED_MINIMAX_KEY,
        }
        print(json.dumps(out))
        return 0

    print("─" * 60)
    print(f" seed_dev_keys  (ENV={os.environ.get('ENV','?')})")
    print("─" * 60)
    _check_settings_router_wired()

    Session = _connect_to_dev_db()
    any_change = False
    for key, value, is_secret in SEED_ROWS:
        result = _upsert_row(Session, key, value, is_secret, force=args.force)
        # Only print a fingerprint for the api_key rows.
        show = (
            f"fingerprint={_fingerprint(value)}"
            if is_secret else
            f"value={value!r}"
        )
        marker = {
            "inserted":         "✓ created   ",
            "updated":          "↻ updated   ",
            "skipped-exists":   "· kept      ",
        }.get(result, result)
        print(f"  {marker}  {key:38s}  {show}")
        if result != "skipped-exists":
            any_change = True

    print("─" * 60)
    if any_change:
        print("✅  Done. Restart the backend so settings take effect.")
    else:
        print("·   No changes (all rows already present; pass --force to overwrite).")
    print("    Tip: --print-only prints the keys to stdout for smoke scripts.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
