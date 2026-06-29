"""Admin: page-agent configuration + server-side LLM proxy."""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.admin_setting import AdminSetting
from ..security import get_current_admin
from ..services.crypto import decrypt_value
from ..services.llm_client import chat_complete, LLMUnavailable
from ..middleware.rate_limit import rate_limit


router = APIRouter(prefix="/api/admin", tags=["admin-agent"])


_DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
_DEFAULT_MODEL = "MiniMax-M3"

# Security guard-rails for the LLM proxy.
MAX_AGENT_MESSAGES = 50
MAX_AGENT_BYTES = 1 * 1024 * 1024  # 1 MB


def _get_setting(db: Session, key: str) -> Optional[str]:
    row = db.query(AdminSetting).filter_by(key=key).first()
    if not row:
        return None
    try:
        return decrypt_value(row.value_encrypted)
    except Exception:
        return None


@router.get("/agent/config")
def get_agent_config(
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    enabled_raw = _get_setting(db, "page_agent.enabled") or "false"
    return {
        "enabled": enabled_raw.strip().lower() in ("true", "1", "yes"),
        "model": _get_setting(db, "page_agent.model") or _DEFAULT_MODEL,
        "base_url": _get_setting(db, "page_agent.base_url") or _DEFAULT_BASE_URL,
    }


class ExecuteRequest(BaseModel):
    messages: list[dict]

    @field_validator("messages")
    @classmethod
    def _cap_messages(cls, v: list[dict]) -> list[dict]:
        if len(v) > MAX_AGENT_MESSAGES:
            raise ValueError(f"messages 长度超过最大限制 {MAX_AGENT_MESSAGES}")
        return v


@router.post("/agent/execute")
@rate_limit(max_calls=20, window_seconds=60)
async def execute_llm(
    request: Request,
    body: ExecuteRequest,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    # Enforce body-size cap (1 MB) — reject obvious abuse early.
    raw = await request.body()
    if len(raw) > MAX_AGENT_BYTES:
        raise HTTPException(status_code=413, detail="请求体超过 1MB 限制")
    config = get_agent_config(db=db, admin=admin)
    if not config["enabled"]:
        raise HTTPException(status_code=409, detail="page-agent 未启用")
    api_key = _get_setting(db, "page_agent.api_key")
    if not api_key:
        raise HTTPException(status_code=409, detail="未配置 page_agent.api_key")
    try:
        content = await chat_complete(
            base_url=config["base_url"],
            api_key=api_key,
            model=config["model"],
            messages=body.messages,
        )
    except LLMUnavailable as e:
        # SECURITY: never echo the raw exception text. Some httpx versions
        # include request headers (e.g. "Authorization: Bearer ...") in the
        # message string, which would leak the API key. Log the full detail
        # server-side and return a generic Chinese message to the client.
        logging.getLogger(__name__).warning(
            "page-agent LLM call failed: %s", e, exc_info=True
        )
        raise HTTPException(status_code=502, detail="上游 LLM 调用失败，请检查网络或 API Key")
    return {"content": content}


@router.post("/settings/{key:path}/test")
async def test_setting(
    key: str,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    """Connectivity probe for a setting. Currently supports page_agent.api_key."""
    if key != "page_agent.api_key":
        raise HTTPException(status_code=400, detail="该 key 暂不支持连通性测试")
    api_key = _get_setting(db, key)
    if not api_key:
        raise HTTPException(status_code=409, detail="未配置该 key")
    base_url = _get_setting(db, "page_agent.base_url") or _DEFAULT_BASE_URL
    model = _get_setting(db, "page_agent.model") or _DEFAULT_MODEL
    try:
        sample = await chat_complete(
            base_url=base_url,
            api_key=api_key,
            model=model,
            messages=[{"role": "user", "content": "ping"}],
        )
    except LLMUnavailable as e:
        logging.getLogger(__name__).warning(
            "page-agent connectivity test failed: %s", e, exc_info=True
        )
        raise HTTPException(status_code=502, detail="连通性测试失败，请检查网络或 API Key")
    return {"ok": True, "sample": sample[:200]}
