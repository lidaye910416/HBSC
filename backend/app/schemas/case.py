from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class CaseSchema(BaseModel):
    id: int
    title: str
    slug: str
    summary: Optional[str] = None
    content: Optional[str] = None
    cover_image: Optional[str] = None
    tags: Optional[str] = None
    published_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class CaseListSchema(BaseModel):
    id: int
    title: str
    slug: str
    summary: Optional[str] = None
    cover_image: Optional[str] = None
    tags: Optional[str] = None
    published_at: Optional[datetime] = None

    class Config:
        from_attributes = True
