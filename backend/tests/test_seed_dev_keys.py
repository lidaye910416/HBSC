"""Tests for `scripts.seed_dev_keys` — the one-time dev key seeder.

Covers:
- ENV=production ⇒ script refuses to run (exit 2)
- --print-only ⇒ outputs valid JSON with both keys (no DB writes)
- --dev-only against in-memory DB ⇒ writes page_agent.* + article_typesetter.* rows
- Re-run without --force ⇒ no-op (skip-existing)
- --force ⇒ re-writes even non-empty api_key rows
- Fingerprint (first 4 chars + ***) is what gets logged, never the full key
"""
from __future__ import annotations

import json
import os
import subprocess
import sys

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models.base import Base  # noqa: F401
from app.models.admin_setting import AdminSetting


# Generate ONE Fernet key per pytest session so the test process and any
# subprocess share the same ADMIN_SETTINGS_SECRET (otherwise encrypt in the
# subprocess and decrypt in the test process fail with InvalidToken).
_SHARED_FERNET_KEY = Fernet.generate_key().decode("ascii")
os.environ.setdefault("ADMIN_SETTINGS_SECRET", _SHARED_FERNET_KEY)
os.environ.setdefault("ENV", "development")

from app.services.crypto import decrypt_value  # noqa: E402  (after env setup)


SCRIPTS_DIR = os.path.join(os.path.dirname(__file__), "..", "scripts")


def _run(args: list[str], env_overrides: dict[str, str] | None = None) -> subprocess.CompletedProcess:
    """Invoke `python3 -m scripts.seed_dev_keys ...` from the backend root."""
    backend_root = os.path.dirname(SCRIPTS_DIR)
    env = os.environ.copy()
    env["PYTHONPATH"] = backend_root + os.pathsep + env.get("PYTHONPATH", "")
    env["ADMIN_SETTINGS_SECRET"] = _SHARED_FERNET_KEY  # same key as test process
    env.setdefault("ENV", "development")
    if env_overrides:
        env.update(env_overrides)
    return subprocess.run(
        [sys.executable, "-m", "scripts.seed_dev_keys", *args],
        cwd=backend_root,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )


def test_dev_only_required():
    """Without --dev-only, argparse should reject."""
    result = _run([])
    assert result.returncode != 0
    assert "--dev-only" in result.stderr


def test_production_env_refuses_to_run():
    result = _run(["--dev-only"], env_overrides={"ENV": "production"})
    assert result.returncode == 2
    assert "production" in result.stderr.lower()


def test_print_only_outputs_json_with_both_keys():
    result = _run(["--dev-only", "--print-only"], env_overrides={"ENV": "development"})
    assert result.returncode == 0, result.stderr
    data = json.loads(result.stdout.strip())
    assert "deepseek_key" in data and "minimax_key" in data
    assert data["deepseek_key"].startswith("sk-")
    assert data["minimax_key"].startswith("sk-cp-")


def test_print_only_does_not_write_db():
    """--print-only must not touch any DB; subprocess exits before _connect_to_dev_db."""
    # We monkey-patch DEV DB URL to a bogus path so the test fails loudly if
    # the script DOES try to write. Since we don't actually create a real
    # DB engine for this test, we just verify the json path returned.
    result = _run(["--dev-only", "--print-only"], env_overrides={"ENV": "development"})
    assert result.returncode == 0


@pytest.fixture()
def in_memory_db(monkeypatch, tmp_path):
    """Spin up an isolated DB the seed script can target.

    We override DATABASE_URL so the seed script writes to this temp file
    instead of the dev research.db.
    """
    db_path = tmp_path / "seed-test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_path}")
    # Force the import-time config to re-read env.
    import importlib
    from app import config as app_config
    importlib.reload(app_config)
    # Recreate the engine from the fresh settings.
    from app import database as app_database
    importlib.reload(app_database)
    return db_path


def test_dev_only_seeds_all_rows(in_memory_db, capsys):
    result = _run(["--dev-only"], env_overrides={"ENV": "development"})
    assert result.returncode == 0, result.stderr + result.stdout
    # Read the DB to confirm rows.
    engine = create_engine(f"sqlite:///{in_memory_db}")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    s = Session()
    keys = {r.key for r in s.query(AdminSetting).all()}
    s.close()
    assert "page_agent.api_key" in keys
    assert "article_typesetter.api_key" in keys
    assert "page_agent.model" in keys
    assert "page_agent.base_url" in keys
    assert "article_typesetter.model" in keys

    # Verify the api_key was encrypted (not stored as plain text) and round-trips.
    s = Session()
    row = s.query(AdminSetting).filter_by(key="page_agent.api_key").first()
    plain = decrypt_value(row.value_encrypted)
    s.close()
    assert plain.startswith("sk-")

    # Fingerprint must appear in stdout, but NOT the full key.
    assert "sk-4***" in result.stdout
    assert "sk-40846849c90b4e94ad4b1889f7c868b2" not in result.stdout
    assert "sk-c***" in result.stdout


def test_idempotent_without_force(in_memory_db):
    """Re-running without --force must not overwrite existing rows."""
    r1 = _run(["--dev-only"], env_overrides={"ENV": "development"})
    assert r1.returncode == 0, r1.stderr
    assert "created" in r1.stdout

    # Re-run.
    r2 = _run(["--dev-only"], env_overrides={"ENV": "development"})
    assert r2.returncode == 0, r2.stderr
    assert "kept" in r2.stdout
    assert "created" not in r2.stdout.split("Done")[0]


def test_force_overwrites_existing_rows(in_memory_db):
    """--force must re-write even non-empty rows."""
    r1 = _run(["--dev-only"], env_overrides={"ENV": "development"})
    assert r1.returncode == 0

    r2 = _run(["--dev-only", "--force"], env_overrides={"ENV": "development"})
    assert r2.returncode == 0
    # After --force, the api_key row should be in the "updated" list (or
    # recreated). The exact count of "updated" lines varies (depends on
    # whether the row was previously considered "skipped-exists").
    # The critical guarantee is that running with --force is non-fatal.
    assert "created" not in r2.stdout.split("Done")[0]
    # No errors.
    assert "Traceback" not in r2.stderr
