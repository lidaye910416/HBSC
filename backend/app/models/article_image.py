from sqlalchemy import Column, Integer, String, DateTime
from datetime import datetime
from .base import Base


class ArticleImage(Base):
    __tablename__ = "article_images"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String(255), unique=True, nullable=False, index=True)
    original_name = Column(String(255))
    mime = Column(String(50), nullable=False)
    size = Column(Integer, nullable=False)
    uploaded_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    uploaded_by = Column(String(100))

    def __repr__(self):
        return f"<ArticleImage {self.filename}>"