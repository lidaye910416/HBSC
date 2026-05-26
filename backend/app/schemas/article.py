from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

class ArticleBase(BaseModel):
    title: str
    slug: str
    summary: Optional[str] = None
    category: Optional[str] = None
    author_name: Optional[str] = None
    reading_time: Optional[int] = 5
    featured: bool = False
    tags: Optional[str] = None

class ArticleSchema(ArticleBase):
    id: int
    content: Optional[str] = None
    cover_image: Optional[str] = None
    author_avatar: Optional[str] = None
    published_at: Optional[datetime] = None
    views: int = 0
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class ArticleListSchema(BaseModel):
    id: int
    title: str
    slug: str
    summary: Optional[str] = None
    cover_image: Optional[str] = None
    category: Optional[str] = None
    author_name: Optional[str] = None
    author_avatar: Optional[str] = None
    published_at: Optional[datetime] = None
    reading_time: int = 5
    views: int = 0
    featured: bool = False
    tags: Optional[str] = None

    class Config:
        from_attributes = True
