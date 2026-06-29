from sqlalchemy import Column, Integer, String, Text
from .base import Base

class Researcher(Base):
    __tablename__ = "researchers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    name_en = Column(String(100))
    title = Column(String(200))  # 职位/头衔
    bio = Column(Text)
    avatar = Column(String(500))
    research_area = Column(String(200))
    email = Column(String(200))
    orcid = Column(String(50))
    twitter = Column(String(100))
    linkedin = Column(String(200))
    order = Column(Integer, default=0)  # 显示顺序
