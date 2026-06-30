#!/usr/bin/env python3
"""End-to-end smoke test for AI 排版.

Default mode (mocked LLM, hermetic):

    cd backend && python3 -m scripts.smoke_typeset

Real-LLM mode (network + api_key):

    cd backend && ENV=development HUBEI_MINIMAX_KEY="<key>" \
        python3 -m scripts.smoke_typeset --real

Mocked mode validates the admin settings + router + service plumbing.
Real mode additionally validates the configured base_url (minimax) is reachable
and the user's api_key authenticates. The mock test does NOT require any
network; the real test requires both network and a valid key (provided via
the HUBEI_MINIMAX_KEY env var).

The --real path never logs the api_key — only a 4-char fingerprint.
"""
from __future__ import annotations

import argparse
import os
import sys
import time
import uuid
from unittest.mock import AsyncMock, patch

from cryptography.fernet import Fernet
os.environ.setdefault("ADMIN_SETTINGS_SECRET", Fernet.generate_key().decode("ascii"))
os.environ.setdefault("ENV", "test")
os.environ.setdefault("SECRET_KEY", "smoke-jwt-secret-" + uuid.uuid4().hex)
os.environ.setdefault("ADMIN_USERNAME", "smoke-admin")

BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_ROOT not in sys.path:
    sys.path.insert(0, BACKEND_ROOT)

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

from app.config import settings  # noqa: E402
from app.database import get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.base import Base  # noqa: F401  registers all tables
from app.models.admin_setting import AdminSetting  # noqa: E402
from app.security import create_access_token, hash_password  # noqa: E402
from app.services import markdown_typesetter  # noqa: E402
from app.services.crypto import encrypt_value  # noqa: E402


BANNER = "─" * 72


def banner(title: str) -> None:
    print(f"\n{BANNER}\n  {title}\n{BANNER}")


# ---------------------------------------------------------------------------
# MOCKED RUN — hermetic; validates admin/settings/service plumbing only.
# ---------------------------------------------------------------------------

def _run_mocked() -> int:
    banner("AI 排版 — 端到端冒烟测试 (mock LLM)")

    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)

    pw_hash = hash_password("smoke-pass-1234")
    s = Session()
    s.add(AdminSetting(
        key="admin_user_seed",
        value_encrypted=encrypt_value(f"smoke-admin:{pw_hash}"),
        is_secret=True,
        description="smoke test credential",
        updated_by="smoke",
    ))
    s.commit()

    def _db():
        sess = Session()
        try:
            yield sess
        finally:
            sess.close()

    app.dependency_overrides[get_db] = _db
    from app.middleware import rate_limit as rl
    rl._buckets.clear()

    token = create_access_token(sub="smoke-admin")
    auth = {"Authorization": f"Bearer {token}"}

    with TestClient(app) as c:
        async def fake_chat(**kwargs):
            user = kwargs["messages"][-1]["content"]
            return (
                "# 标题\n\n"
                "这是一个清洗过的段落；中文/英文之间补了空格 ， 标点 也 统一为全角。\n\n"
                f"_前 N 字: {user[:8]}..._\n"
            )

        patched = AsyncMock(side_effect=fake_chat)
        patcher = patch.object(markdown_typesetter, "chat_complete", new=patched)

        with patcher:
            banner("1. 启动内存后端 + 种子管理员")
            # (already done above)

            banner("2. 通过 PUT /api/admin/settings/{key} 配置 AI 排版 (同 UI 等价)")
            seed_rows = [
                ("article_typesetter.enabled",       "true",                                False),
                ("article_typesetter.model",         "MiniMax-M3",                          False),
                ("article_typesetter.base_url",      "https://api.minimaxi.com/v1",        False),
                ("article_typesetter.api_key",       "smoke-fake-key-DEADBEEF",             True),
                ("article_typesetter.system_prompt", "你只清洗 Markdown，不要润色。",        False),
            ]
            for key, value, _is_secret in seed_rows:
                r = c.put(
                    f"/api/admin/settings/{key}",
                    headers=auth,
                    json={"value": value, "description": "smoke seeded"},
                )
                print(f"   PUT {key:42s}  → {r.status_code}")
                assert r.status_code == 200, r.text

            banner("3. GET /api/admin/settings — 确认写入生效 + 默认值合成")
            r = c.get("/api/admin/settings", headers=auth)
            assert r.status_code == 200, r.text
            items = {it["key"]: it for it in r.json()["items"]}
            assert items["article_typesetter.enabled"]["value"] == "true"
            assert items["article_typesetter.model"]["value"] == "MiniMax-M3"
            assert items["article_typesetter.base_url"]["value"] == "https://api.minimaxi.com/v1"
            assert items["article_typesetter.api_key"]["is_secret"] is True
            assert items["article_typesetter.api_key"]["value"] is None
            assert items["article_typesetter.api_key"]["masked"] == "smok***"
            print(f"   api_key masked as: {items['article_typesetter.api_key']['masked']}")
            print(f"   system_prompt stored: {'你只清洗 Markdown' in items['article_typesetter.system_prompt']['value']}")

            banner("4. POST /api/admin/articles/typeset — 调用清洗服务")
            sample = (
                "## 标题\n\n"
                "  这是一段 pandoc 残留的空行 + 缩进 + 半角句号. 还有english混排问题。  "
                "\n\n"
                "## 第二节\n"
                "正文段落.\n"
            )
            rl._buckets.clear()  # avoid bleed-over from prior sections
            t0 = time.time()
            r = c.post(
                "/api/admin/articles/typeset",
                headers=auth,
                json={"content_markdown": sample},
            )
            dt_ms = int((time.time() - t0) * 1000)
            assert r.status_code == 200, f"{r.status_code} {r.text}"
            body = r.json()
            print(f"   耗时 {dt_ms}ms  status 200")
            print(f"   model            : {body['model']}")
            print(f"   prompt_version   : {body['prompt_version']}")
            print(f"   warnings         : {body['warnings']}")
            print(f"   content_markdown :\n     {body['content_markdown']}")

            assert patched.call_count == 1
            call = patched.call_args.kwargs
            assert call["base_url"] == "https://api.minimaxi.com/v1"
            assert call["api_key"] == "smoke-fake-key-DEADBEEF"
            assert call["model"] == "MiniMax-M3"
            assert len(call["messages"]) == 2
            assert call["messages"][0]["role"] == "system"
            assert call["messages"][0]["content"] == "你只清洗 Markdown，不要润色。"
            assert call["messages"][1]["role"] == "user"
            assert call["messages"][1]["content"] == sample
            print("   ✓ chat_complete 用 minimax base_url + 用户 api_key 调通")

            banner("5. 关掉 enabled → 期望 409 not_enabled")
            c.put(
                "/api/admin/settings/article_typesetter.enabled",
                headers=auth,
                json={"value": "false"},
            )
            r = c.post(
                "/api/admin/articles/typeset",
                headers=auth,
                json={"content_markdown": "x"},
            )
            assert r.status_code == 409 and r.json()["error"]["code"] == "not_enabled"
            print(f"   ✓ 收到 409 not_enabled")

            banner("6. 删 api_key → 期望 409 no_api_key")
            c.put(
                "/api/admin/settings/article_typesetter.enabled",
                headers=auth,
                json={"value": "true"},
            )
            sess = Session()
            sess.query(AdminSetting).filter_by(key="article_typesetter.api_key").delete()
            sess.commit()
            r = c.post(
                "/api/admin/articles/typeset",
                headers=auth,
                json={"content_markdown": "x"},
            )
            assert r.status_code == 409 and r.json()["error"]["code"] == "no_api_key"
            print(f"   ✓ 收到 409 no_api_key")

            banner("7. 50k 字符长文本 → 32k 截断 + warning")
            sess = Session()
            sess.add(AdminSetting(
                key="article_typesetter.api_key",
                value_encrypted=encrypt_value("smoke-fake-key-DEADBEEF"),
                is_secret=True,
                description="re-seeded for truncation test",
                updated_by="smoke",
            ))
            sess.commit()
            long_input = "中" * 50_000
            r = c.post(
                "/api/admin/articles/typeset",
                headers=auth,
                json={"content_markdown": long_input},
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert any("截断" in w for w in body["warnings"]), body
            user_msg = patched.call_args.kwargs["messages"][-1]["content"]
            assert len(user_msg) <= 32_000
            print(f"   ✓ 截断生效：警告={body['warnings']}, LLM 实际收到 {len(user_msg)} 字")

    banner("全部通过 ✅")
    print("""
  → 真实部署只需：
     1) Admin 登录后到 设置 → AI 排版
     2) 填入 minimax 控制台 rotate 后的新 API Key
     3) 点保存 + 测试连通
     4) ArticleEditor 里的「AI 排版」按钮变 enabled
""")
    return 0


# ---------------------------------------------------------------------------
# REAL RUN — uses real minimax; requires network + HUBEI_MINIMAX_KEY env.
# ---------------------------------------------------------------------------

def _run_real() -> int:
    api_key = os.environ.get("HUBEI_MINIMAX_KEY")
    if not api_key:
        print("⛔  --real 需要 HUBEI_MINIMAX_KEY 环境变量", file=sys.stderr)
        return 2
    fingerprint = api_key[:4] + "***"
    banner(f"AI 排版 — 真实 LLM 冒烟测试 (minimax key={fingerprint})")

    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)

    def _db():
        sess = Session()
        try:
            yield sess
        finally:
            sess.close()

    app.dependency_overrides[get_db] = _db
    from app.middleware import rate_limit as rl
    rl._buckets.clear()

    token = create_access_token(sub="real-smoke-admin")
    auth = {"Authorization": f"Bearer {token}"}

    with TestClient(app) as c:
        banner("1. 配置 article_typesetter.* = minimax token plan preset")
        for key, value, _sec in [
            ("article_typesetter.enabled",  "true",                            False),
            ("article_typesetter.model",    "MiniMax-M3",                      False),
            ("article_typesetter.base_url", "https://api.minimaxi.com/v1",    False),
            ("article_typesetter.api_key",  api_key,                           True),
        ]:
            r = c.put(
                f"/api/admin/settings/{key}",
                headers=auth,
                json={"value": value},
            )
            assert r.status_code == 200, r.text
        print(f"   ✓ 4 行设置已写入（api_key={fingerprint}）")

        banner("2. 真实调 minimax — 用一个 200 字样本验证模型返回")
        sample = (
            "## 标题\n\n"
            "  这是引入篇. 有中english混排和半角标点  .   "
            "还有 list 残留格式 - item1 - item2\n\n"
            "## 第二节\n"
            "还有一些正文.\n"
        )[:400]
        t0 = time.time()
        r = c.post(
            "/api/admin/articles/typeset",
            headers=auth,
            json={"content_markdown": sample},
        )
        dt_ms = int((time.time() - t0) * 1000)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        body = r.json()
        assert len(body["content_markdown"]) > 10
        print(f"   ✓ 200 OK in {dt_ms}ms")
        print(f"   model           : {body['model']}")
        print(f"   warnings        : {body['warnings']}")
        cleaned_preview = body["content_markdown"][:160].replace("\n", "\n      ")
        print(f"   cleaned preview :\n      {cleaned_preview}")
        # CRITICAL: never print the api_key.
        assert api_key not in r.text
        assert body["model"] == "MiniMax-M3"

    banner(f"全部通过 ✅ 真实 minimax 连通 ({fingerprint})")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="AI 排版冒烟测试")
    parser.add_argument(
        "--real",
        action="store_true",
        help="调真 minimax（需要 HUBEI_MINIMAX_KEY 环境变量）",
    )
    args = parser.parse_args()
    if args.real:
        return _run_real()
    return _run_mocked()


if __name__ == "__main__":
    sys.exit(main())
