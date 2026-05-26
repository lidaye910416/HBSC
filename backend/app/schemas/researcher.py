from pydantic import BaseModel
from typing import Optional

class ResearcherSchema(BaseModel):
    id: int
    name: str
    name_en: Optional[str] = None
    title: Optional[str] = None
    bio: Optional[str] = None
    avatar: Optional[str] = None
    research_area: Optional[str] = None
    email: Optional[str] = None
    orcid: Optional[str] = None
    twitter: Optional[str] = None
    linkedin: Optional[str] = None
    order: int = 0

    class Config:
        from_attributes = True
