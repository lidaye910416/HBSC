from sqlalchemy import Column, Integer, String, Text, DateTime
from .base import Base
from datetime import datetime

class Case(Base):
    __tablename__ = "cases"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    slug = Column(String(300), unique=True, index=True)
    summary = Column(Text)
    content = Column(Text)  # Markdown
    cover_image = Column(String(500))
    tags = Column(String(500))  # JSON string
    published_at = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)
