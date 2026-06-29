import pytest
from unittest.mock import AsyncMock, patch

from app.services.llm_client import LLMUnavailable, chat_complete


@pytest.mark.asyncio
async def test_chat_complete_returns_text():
    fake_response = {
        "choices": [{"message": {"role": "assistant", "content": "hi"}}]
    }
    with patch("app.services.llm_client.httpx.AsyncClient") as MockClient:
        client = MockClient.return_value.__aenter__.return_value
        client.post = AsyncMock(return_value=AsyncMock(
            status_code=200, json=lambda: fake_response, raise_for_status=lambda: None
        ))
        out = await chat_complete(
            base_url="https://example.com/v1",
            api_key="k",
            model="m",
            messages=[{"role": "user", "content": "hello"}],
        )
        assert out == "hi"


@pytest.mark.asyncio
async def test_chat_complete_raises_on_error():
    with patch("app.services.llm_client.httpx.AsyncClient") as MockClient:
        client = MockClient.return_value.__aenter__.return_value
        resp = AsyncMock(status_code=401, text="bad key", raise_for_status=AsyncMock(side_effect=Exception("401")))
        client.post = AsyncMock(return_value=resp)
        with pytest.raises(LLMUnavailable):
            await chat_complete("https://x", "k", "m", [{"role": "user", "content": "hi"}])
