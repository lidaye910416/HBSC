from pydantic import BaseModel
from typing import Optional

class DomainSchema(BaseModel):
    id: int
    name: str
    slug: str
    description: Optional[str] = None
    icon: Optional[str] = None
    color: Optional[str] = None
    article_count: int = 0
    order: int = 0

    class Config:
        from_attributes = True
