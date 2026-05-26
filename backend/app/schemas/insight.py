from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class InsightSchema(BaseModel):
    id: int
    title: str
    content: Optional[str] = None
    category: Optional[str] = None
    source: Optional[str] = None
    source_url: Optional[str] = None
    author_name: Optional[str] = None
    published_at: Optional[datetime] = None

    class Config:
        from_attributes = True
