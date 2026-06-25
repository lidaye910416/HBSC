"""图片上传服务：保存到 UPLOAD_DIR/YYYY/MM/<uuid>.<ext>，写入 ArticleImage 表。"""
import uuid
from datetime import datetime
from pathlib import Path
from typing import AsyncIterator, Optional
from io import BytesIO

from PIL import Image, UnidentifiedImageError
from sqlalchemy.orm import Session

from .config import settings
from .models.article_image import ArticleImage


ALLOWED_MIMES = {m.strip() for m in settings.UPLOAD_ALLOWED_MIMES.split(",") if m.strip()}
EXT_TO_MIME = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}

# 分块读取大小：1 MB，避免一次性把大文件加载进内存
CHUNK_SIZE = 1024 * 1024


def _max_bytes() -> int:
    return settings.UPLOAD_MAX_SIZE_MB * 1024 * 1024


class UploadTooLarge(Exception):
    """上传文件超过最大限制。"""
    def __init__(self, max_mb: int):
        self.max_mb = max_mb
        super().__init__(f"文件超过 {max_mb} MB 限制")


async def read_upload_with_limit(file) -> bytes:
    """分块读取上传流，累计大小，超过限制时立即抛 UploadTooLarge。

    避免 await file.read() 把整个文件一次性读入内存导致 OOM。
    """
    max_bytes = _max_bytes()
    size = 0
    chunks: list[bytes] = []
    while True:
        chunk = await file.read(CHUNK_SIZE)
        if not chunk:
            break
        size += len(chunk)
        if size > max_bytes:
            raise UploadTooLarge(settings.UPLOAD_MAX_SIZE_MB)
        chunks.append(chunk)
    return b"".join(chunks)


def _detect_mime(content: bytes, fallback_filename: str) -> str:
    """用 Pillow 嗅探真实 mime，扩展名不可信。"""
    try:
        img = Image.open(BytesIO(content))
        fmt = (img.format or "").upper()
        mapping = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp", "GIF": "image/gif"}
        if fmt in mapping:
            return mapping[fmt]
    except UnidentifiedImageError:
        pass
    # 回退：从文件名后缀推断
    suffix = Path(fallback_filename).suffix.lower()
    fallback = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                ".webp": "image/webp", ".gif": "image/gif"}
    if suffix in fallback:
        return fallback[suffix]
    raise ValueError(f"不支持的文件类型：{fallback_filename}")


def save_upload(filename: str, content: bytes, uploaded_by: Optional[str], db: Optional[Session] = None) -> dict:
    """保存上传文件，返回 {url, filename, mime, size, original_name}。"""
    if len(content) > _max_bytes():
        raise ValueError(f"文件超过 {settings.UPLOAD_MAX_SIZE_MB} MB 限制")

    mime = _detect_mime(content, filename)
    if mime not in ALLOWED_MIMES:
        raise ValueError(f"不支持的文件类型：{mime}")

    ext = EXT_TO_MIME[mime]
    new_filename = f"{uuid.uuid4().hex}{ext}"

    upload_root = Path(settings.UPLOAD_DIR)
    now = datetime.utcnow()
    target_dir = upload_root / f"{now.year:04d}" / f"{now.month:02d}"
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / new_filename
    target_path.write_bytes(content)

    url = f"/uploads/{now.year:04d}/{now.month:02d}/{new_filename}"

    info = {
        "url": url,
        "filename": new_filename,
        "mime": mime,
        "size": len(content),
        "original_name": filename,
    }
    if db is not None:
        record = ArticleImage(
            filename=new_filename,
            original_name=filename,
            mime=mime,
            size=len(content),
            uploaded_by=uploaded_by,
        )
        db.add(record)
        db.commit()
        info["id"] = record.id
        info["uploaded_at"] = record.uploaded_at.isoformat()
    return info


def get_public_path(url: str) -> Path:
    """把 /uploads/2026/06/abc.png 转成磁盘路径。"""
    upload_root = Path(settings.UPLOAD_DIR).resolve()
    rel = url.lstrip("/").removeprefix("uploads/").lstrip("/")
    return upload_root / rel
