"""Admin: import a .docx and return its Markdown without writing to DB."""
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile

from ..config import settings
from ..security import get_current_admin
from ..services.docx_import import (
    PandocUnavailable,
    convert_docx_to_markdown,
)
from ..upload_service import UploadTooLarge, read_upload_with_limit


router = APIRouter(prefix="/api/admin/articles", tags=["admin-articles"])


_ALLOWED_DOCX_MIMES = {
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/octet-stream",  # some browsers send this for .docx
}


@router.post("/import-docx")
async def import_docx(
    file: UploadFile,
    admin: str = Depends(get_current_admin),
):
    try:
        content = await read_upload_with_limit(file)
    except UploadTooLarge as e:
        raise HTTPException(status_code=413, detail=str(e))

    if not (file.filename or "").lower().endswith(".docx"):
        raise HTTPException(status_code=400, detail="仅支持 .docx 文件")
    if file.content_type and file.content_type not in _ALLOWED_DOCX_MIMES:
        raise HTTPException(status_code=415, detail=f"不支持的 MIME: {file.content_type}")

    media_dir = Path(settings.UPLOAD_DIR) / "imports"
    media_dir.mkdir(parents=True, exist_ok=True)

    try:
        result = convert_docx_to_markdown(content, media_dir=media_dir)
    except PandocUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=422, detail={"code": "pandoc_failed", "message": str(e)})

    return {
        "title": result.title,
        "content_markdown": result.content_markdown,
        "suggested_slug": result.suggested_slug,
        "warnings": result.warnings,
        "images": result.images,
    }
