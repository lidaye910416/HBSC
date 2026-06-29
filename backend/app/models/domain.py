from sqlalchemy import Column, Integer, String, Text
from .base import Base

class Domain(Base):
    __tablename__ = "domains"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    slug = Column(String(200), unique=True, index=True)
    description = Column(Text)
    icon = Column(String(100))  # Lucide icon name
    color = Column(String(20))   # 主题色
    article_count = Column(Integer, default=0)
    order = Column(Integer, default=0)
