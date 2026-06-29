"""Minimal OpenAI-compatible chat completion client used by page-agent proxy."""
from typing import Iterable

import httpx


class LLMUnavailable(Exception):
    """Raised when the upstream LLM call fails."""


async def chat_complete(
    base_url: str,
    api_key: str,
    model: str,
    messages: Iterable[dict],
    *,
    timeout: float = 30.0,
) -> str:
    """Call POST {base_url}/chat/completions and return the assistant text."""
    url = base_url.rstrip("/") + "/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    body = {"model": model, "messages": list(messages), "stream": False}
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post(url, headers=headers, json=body)
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        raise LLMUnavailable(str(e)) from e

    try:
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as e:
        raise LLMUnavailable(f"unexpected response shape: {e}") from e
