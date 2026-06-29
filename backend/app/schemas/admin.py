"""Admin 专用 Pydantic schema（区别于公开 schemas/article.py 的 ArticleSchema）。"""
from datetime import datetime
from typing import Optional, List, Literal
from pydantic import BaseModel, Field, field_validator
import re


SLUG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def _validate_slug(v: str) -> str:
    if not SLUG_PATTERN.match(v):
        raise ValueError("slug 只能包含小写字母、数字和连字符")
    return v


class ArticleCreate(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    slug: str = Field(min_length=1, max_length=200)

    @field_validator("slug")
    @classmethod
    def _check_slug(cls, v: str) -> str:
        return _validate_slug(v)

    summary: Optional[str] = None
    content: Optional[str] = None
    cover_image: Optional[str] = None
    cover_image_alt: Optional[str] = None
    category: Optional[str] = Field(None, max_length=100)
    author_name: Optional[str] = Field(None, max_length=100)
    author_avatar: Optional[str] = None
    reading_time: int = Field(5, ge=1, le=999)
    featured: bool = False
    status: Literal["draft", "published"] = "draft"
    tags: Optional[List[str]] = None
    journal_id: Optional[int] = None


class ArticleUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=500)
    summary: Optional[str] = None
    content: Optional[str] = None
    cover_image: Optional[str] = None
    cover_image_alt: Optional[str] = None
    category: Optional[str] = Field(None, max_length=100)
    author_name: Optional[str] = Field(None, max_length=100)
    author_avatar: Optional[str] = None
    reading_time: Optional[int] = Field(None, ge=1, le=999)
    featured: Optional[bool] = None
    status: Optional[Literal["draft", "published"]] = None
    tags: Optional[List[str]] = None
    journal_id: Optional[int] = None
    # 注意：slug 不可编辑（避免外链失效）


class ArticleAdminOut(BaseModel):
    id: int
    title: str
    slug: str
    summary: Optional[str] = None
    content: Optional[str] = None
    cover_image: Optional[str] = None
    cover_image_alt: Optional[str] = None
    category: Optional[str] = None
    author_name: Optional[str] = None
    author_avatar: Optional[str] = None
    reading_time: int
    views: int
    featured: bool
    status: str
    tags: Optional[List[str]] = None
    journal_id: Optional[int] = None
    published_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class JournalCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    slug: str = Field(min_length=1, max_length=100)

    @field_validator("slug")
    @classmethod
    def _check_slug(cls, v: str) -> str:
        return _validate_slug(v)

    cover_image: Optional[str] = None
    description: Optional[str] = None
    issue_number: Optional[str] = Field(None, max_length=50)
    status: Literal["draft", "published"] = "draft"
    published_at: Optional[datetime] = None


class JournalUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    cover_image: Optional[str] = None
    description: Optional[str] = None
    issue_number: Optional[str] = Field(None, max_length=50)
    status: Optional[Literal["draft", "published"]] = None
    published_at: Optional[datetime] = None


class JournalAdminOut(BaseModel):
    id: int
    title: str
    slug: str
    cover_image: Optional[str] = None
    description: Optional[str] = None
    issue_number: Optional[str] = None
    status: str = "draft"
    published_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    article_count: int = 0

    class Config:
        from_attributes = True


class MediaOut(BaseModel):
    id: int
    filename: str
    url: str
    original_name: str
    mime: str
    size: int
    uploaded_at: datetime

    class Config:
        from_attributes = True


class OkResponse(BaseModel):
    ok: bool = True


class ImageGenRequest(BaseModel):
    """AI 生图请求（仅 admin 端点使用）。"""
    prompt: str = Field(min_length=1, max_length=2000)
    aspect_ratio: Literal["16:9", "1:1", "4:3"] = "16:9"


class ArticleAdminSummaryOut(BaseModel):
    """Same as ArticleAdminOut but without the unbounded Markdown content.

    Used by the 4-Tab JournalDetail endpoint, which serializes many
    articles at once and only needs summary/title/etc.
    """
    id: int
    title: str
    slug: str
    summary: Optional[str] = None
    cover_image: Optional[str] = None
    cover_image_alt: Optional[str] = None
    category: Optional[str] = None
    author_name: Optional[str] = None
    author_avatar: Optional[str] = None
    reading_time: int
    views: int
    featured: bool
    status: str
    tags: Optional[List[str]] = None
    journal_id: Optional[int] = None
    published_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class JournalArticlesByCategoryOut(BaseModel):
    """Per-category article list for the 4-Tab UI. Drafts included."""
    strategy: list[ArticleAdminSummaryOut]      # 战略与政策
    technology: list[ArticleAdminSummaryOut]    # 技术与产业
    solution: list[ArticleAdminSummaryOut]      # 方案与思考
    dynamics: list[ArticleAdminSummaryOut]      # 动态与文化
    completeness: dict