from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
from .base import Base


class Journal(Base):
    __tablename__ = "journals"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    slug = Column(String(100), unique=True, nullable=False, index=True)
    cover_image = Column(String(500))
    description = Column(Text)
    issue_number = Column(String(50))
    status = Column(String(20), nullable=False, default="published", index=True)
    published_at = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    articles = relationship("Article", back_populates="journal", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Journal {self.title}>"


class Article(Base):
    __tablename__ = "articles"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(500), nullable=False)
    slug = Column(String(200), unique=True, nullable=False, index=True)
    summary = Column(Text)
    content = Column(Text)
    cover_image = Column(String(500))
    cover_image_alt = Column(String(255))
    category = Column(String(100), index=True)
    author_name = Column(String(100))
    author_avatar = Column(String(500))
    reading_time = Column(Integer, default=5)
    views = Column(Integer, default=0)
    tags = Column(String(500))
    featured = Column(Integer, default=0)
    status = Column(String(20), default="published", index=True, nullable=False)
    published_at = Column(DateTime, default=datetime.utcnow, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    journal_id = Column(Integer, ForeignKey("journals.id"))
    journal = relationship("Journal", back_populates="articles")

    def __repr__(self):
        return f"<Article {self.title}>"