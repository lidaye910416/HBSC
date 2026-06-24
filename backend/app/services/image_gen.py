"""AI 图像生成服务（minimax 平台）。

设计目标：
- 没有 MINIMAX_TOKEN 时也能跑：本地 PIL 生成带 prompt 文字的渐变占位图，
  写入 UPLOAD_DIR 同样的目录结构（YYYY/MM/<uuid>.png），返回与真实 API 一致的字典。
- 有 MINIMAX_TOKEN 时：POST JSON 到 MINIMAX_API_URL，
  期望返回 { "image": "<base64 或 url>" }，解码后落盘。

统一返回：
    {
        "url": "/uploads/2026/06/<uuid>.png",
        "filename": "<uuid>.png",
        "mime": "image/png",
        "size": <bytes>,
        "prompt": <原文>,
        "model": <使用的模型>,
        "status": "placeholder" | "generated",
    }
"""
from __future__ import annotations

import base64
import uuid
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, Optional

import httpx
from PIL import Image, ImageDraw, ImageFont

from ..config import settings


# ----- 尺寸映射 -----
ASPECT_RATIOS: Dict[str, tuple[int, int]] = {
    "16:9": (1280, 720),
    "1:1": (1024, 1024),
    "4:3": (1024, 768),
}


def _aspect_to_size(aspect_ratio: str) -> tuple[int, int]:
    if aspect_ratio not in ASPECT_RATIOS:
        # 默认 16:9，不抛异常以保持健壮
        return ASPECT_RATIOS["16:9"]
    return ASPECT_RATIOS[aspect_ratio]


def _resolve_font(size: int) -> ImageFont.ImageFont:
    """找一个支持中文/英文的字体；找不到就用默认。"""
    candidates = [
        "/System/Library/Fonts/PingFang.ttc",  # macOS
        "/System/Library/Fonts/STHeiti Medium.ttc",
        "/System/Library/Fonts/Hiragino Sans GB.ttc",
        "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",  # Linux
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "C:/Windows/Fonts/msyh.ttc",  # Windows
    ]
    for path in candidates:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size=size)
            except (OSError, IOError):
                continue
    return ImageFont.load_default()


def _wrap_text(text: str, max_chars: int) -> list[str]:
    """粗略按 max_chars 字符换行（中英文都按 1 字符算）。"""
    text = text.strip()
    if not text:
        return ["(empty prompt)"]
    if len(text) <= max_chars:
        return [text]
    lines: list[str] = []
    for i in range(0, len(text), max_chars):
        lines.append(text[i : i + max_chars])
    return lines


def _make_placeholder_png(prompt: str, aspect_ratio: str) -> bytes:
    """生成带 prompt 文字的渐变占位 PNG。"""
    width, height = _aspect_to_size(aspect_ratio)

    # 渐变（墨色到深墨色，搭配主品牌色）
    img = Image.new("RGB", (width, height), "#1A1A2E")
    draw = ImageDraw.Draw(img)

    # 对角线渐变
    top_color = (26, 26, 46)      # #1A1A2E
    bottom_color = (22, 33, 62)   # #16213E
    accent_color = (201, 168, 76)  # #C9A84C
    for y in range(height):
        t = y / max(height - 1, 1)
        r = int(top_color[0] * (1 - t) + bottom_color[0] * t)
        g = int(top_color[1] * (1 - t) + bottom_color[1] * t)
        b = int(top_color[2] * (1 - t) + bottom_color[2] * t)
        draw.line([(0, y), (width, y)], fill=(r, g, b))

    # 中央放占位标识
    title_font = _resolve_font(48)
    sub_font = _resolve_font(24)
    badge = "AI Generated Placeholder"
    bbox = draw.textbbox((0, 0), badge, font=title_font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(((width - tw) / 2, height / 2 - th - 20), badge, font=title_font, fill=accent_color)

    # prompt 文本（截断 + 换行）
    line_max = max(20, width // 32)
    lines = _wrap_text(prompt, line_max)[:6]  # 最多 6 行
    line_h = 32
    total_h = line_h * len(lines)
    y = (height - total_h) / 2 + 30
    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=sub_font)
        lw = bbox[2] - bbox[0]
        draw.text(((width - lw) / 2, y), line, font=sub_font, fill=(245, 240, 232))
        y += line_h

    buf = BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def _save_to_uploads(content: bytes) -> dict:
    """把 bytes 写入 UPLOAD_DIR/YYYY/MM/<uuid>.png，返回 {url, filename, mime, size}。"""
    upload_root = Path(settings.UPLOAD_DIR)
    now = datetime.utcnow()
    target_dir = upload_root / f"{now.year:04d}" / f"{now.month:02d}"
    target_dir.mkdir(parents=True, exist_ok=True)

    new_filename = f"{uuid.uuid4().hex}.png"
    target_path = target_dir / new_filename
    target_path.write_bytes(content)

    return {
        "url": f"/uploads/{now.year:04d}/{now.month:02d}/{new_filename}",
        "filename": new_filename,
        "mime": "image/png",
        "size": len(content),
    }


async def _call_minimax_api(
    prompt: str, aspect_ratio: str, model: str
) -> bytes:
    """调用 minimax 图像生成 API，返回图片 bytes。

    期望响应：JSON 中含 "image" 字段（base64 字符串）或 "url" 字段（远程 URL）。
    失败抛 RuntimeError，由上层记录到日志。
    """
    url = settings.MINIMAX_API_URL
    token = settings.MINIMAX_TOKEN
    if not token:
        raise RuntimeError("MINIMAX_TOKEN is not set")

    width, height = _aspect_to_size(aspect_ratio)
    payload = {
        "model": model,
        "prompt": prompt,
        "width": width,
        "height": height,
        "aspect_ratio": aspect_ratio,
        "response_format": "b64_json",
    }
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(url, json=payload, headers=headers)

    if resp.status_code >= 400:
        # 截取前 500 字符避免日志爆炸
        snippet = resp.text[:500]
        raise RuntimeError(
            f"minimax API {resp.status_code}: {snippet}"
        )

    data: Dict[str, Any] = resp.json()
    # 多种可能字段名
    if "image_base64" in data:
        return base64.b64decode(data["image_base64"])
    if "b64_json" in data:
        return base64.b64decode(data["b64_json"])
    if "image" in data and isinstance(data["image"], str):
        # 可能是 url，也可能是 base64
        val = data["image"]
        if val.startswith("http://") or val.startswith("https://"):
            return await _fetch_remote_image(val)
        return base64.b64decode(val)
    if "url" in data and isinstance(data["url"], str):
        return await _fetch_remote_image(data["url"])
    if "data" in data and isinstance(data["data"], list) and data["data"]:
        first = data["data"][0]
        if isinstance(first, dict):
            if "b64_json" in first:
                return base64.b64decode(first["b64_json"])
            if "url" in first:
                return await _fetch_remote_image(first["url"])
    raise RuntimeError(f"minimax API response missing image field: keys={list(data.keys())}")


async def _fetch_remote_image(url: str) -> bytes:
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.get(url)
    if resp.status_code >= 400:
        raise RuntimeError(f"fetch image {resp.status_code}")
    return resp.content


async def generate_image(prompt: str, aspect_ratio: str = "16:9") -> dict:
    """生成图片。

    - 有 MINIMAX_TOKEN：调用真实 API，失败回退到占位图。
    - 没 token：直接生成 PIL 占位图。

    返回字典结构见模块 docstring。
    """
    model = settings.MINIMAX_MODEL
    status_label = "placeholder"
    content: Optional[bytes] = None

    if settings.MINIMAX_TOKEN:
        try:
            content = await _call_minimax_api(prompt, aspect_ratio, model)
            status_label = "generated"
        except Exception:
            # 真实 API 失败时回退，避免阻塞管理后台
            content = None

    if content is None:
        content = _make_placeholder_png(prompt, aspect_ratio)
        status_label = "placeholder"

    info = _save_to_uploads(content)
    info["prompt"] = prompt
    info["model"] = model
    info["status"] = status_label
    return info
