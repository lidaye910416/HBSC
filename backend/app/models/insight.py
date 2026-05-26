from sqlalchemy import Column, Integer, String, Text, DateTime
from ..database import Base
from datetime import datetime

class Insight(Base):
    __tablename__ = "insights"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    content = Column(Text)
    category = Column(String(100))  # 政策/技术/学术/产业
    source = Column(String(255))
    source_url = Column(String(500))
    author_name = Column(String(100))
    published_at = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)
