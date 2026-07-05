"""Admin: AI typeset an article's Markdown body via the configured LLM.

This endpoint is READ-ONLY with respect to the DB. The admin still saves /
publishes through the regular ArticleEditor flow after accepting the
cleaned markdown.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..middleware.rate_limit import rate_limit
from ..security import get_current_admin
from ..services.llm_client import LLMUnavailable
from ..services.markdown_typesetter import (
    TypesetError,
    typeset_markdown as _typeset,
)


router = APIRouter(prefix="/api/admin/articles", tags=["admin-articles"])
_log = logging.getLogger(__name__)


MAX_TYPESET_BYTES = 1 * 1024 * 1024  # 1 MB (matches page-agent convention)


class TypesetRequest(BaseModel):
    content_markdown: str = Field(..., min_length=0, max_length=1_000_000)
    style: Optional[str] = Field(
        default=None,
        description="Optional voice: academic | business | concise.",
        max_length=32,
    )
    variant: Optional[int] = Field(
        default=None,
        description="Bump to force a fresh generation that bypasses any cache.",
        ge=0,
        le=1_000_000,
    )


class TypesetResponse(BaseModel):
    content_markdown: str
    warnings: list[str] = []
    model: str = ""
    prompt_version: str = ""


def _send(code: str, message: str, status: int) -> None:
    raise HTTPException(status_code=status, detail={"code": code, "message": message})


@router.post("/typeset", response_model=TypesetResponse)
@rate_limit(max_calls=5, window_seconds=60)
async def typeset_article(
    request: Request,
    body: TypesetRequest,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    raw = await request.body()
    if len(raw) > MAX_TYPESET_BYTES:
        _send("payload_too_large", "请求体超过 1MB 限制", 413)

    try:
        # variant is a cache-busting knob the admin UI bumps to force a
        # fresh generation. The service intentionally ignores it; we accept
        # it here so the request schema stays forward-compatible with any
        # future server-side dedupe.
        result = await _typeset(body.content_markdown, db=db, style=body.style)
    except TypesetError as e:
        _send(e.code, e.message, 409)
    except LLMUnavailable:
        _log.warning("typeset: upstream LLM failed", exc_info=True)
        _send("upstream_llm_failed", "上游 LLM 调用失败，请检查网络或 API Key", 502)
    except Exception:
        _log.exception("typeset: unexpected error")
        _send("internal_error", "服务异常，请稍后重试", 500)

    return TypesetResponse(
        content_markdown=result.content_markdown,
        warnings=result.warnings,
        model=result.model,
        prompt_version=result.prompt_version,
    )
