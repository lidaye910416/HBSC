from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey, Table
from sqlalchemy.orm import relationship
from ..database import Base
from datetime import datetime

article_tags = Table(
    'article_tags',
    Base.metadata,
    Column('article_id', Integer, ForeignKey('articles.id')),
    Column('tag', String(50))
)

class Article(Base):
    __tablename__ = "articles"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    slug = Column(String(300), unique=True, index=True)
    summary = Column(Text)
    content = Column(Text)  # Markdown content
    cover_image = Column(String(500))
    category = Column(String(100))
    author_name = Column(String(100))
    author_avatar = Column(String(500))
    published_at = Column(DateTime, default=datetime.utcnow)
    reading_time = Column(Integer, default=5)  # 分钟
    views = Column(Integer, default=0)
    featured = Column(Boolean, default=False)
    tags = Column(String(500))  # JSON string
    created_at = Column(DateTime, default=datetime.utcnow)
