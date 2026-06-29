"""Admin: page-agent configuration + server-side LLM proxy."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.admin_setting import AdminSetting
from ..security import get_current_admin
from ..services.crypto import decrypt_value
from ..services.llm_client import chat_complete, LLMUnavailable


router = APIRouter(prefix="/api/admin", tags=["admin-agent"])


_DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
_DEFAULT_MODEL = "MiniMax-M3"


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


@router.post("/agent/execute")
async def execute_llm(
    body: ExecuteRequest,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
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
        raise HTTPException(status_code=502, detail=f"LLM 调用失败: {e}")
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
        raise HTTPException(status_code=502, detail=f"连通性测试失败: {e}")
    return {"ok": True, "sample": sample[:200]}
