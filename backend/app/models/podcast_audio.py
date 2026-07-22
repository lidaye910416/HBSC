from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from .base import Base


class PodcastAudio(Base):
    __tablename__ = "podcast_audios"

    id = Column(Integer, primary_key=True, index=True)
    article_id = Column(Integer, ForeignKey("articles.id", ondelete="CASCADE"), unique=True, nullable=False, index=True)
    status = Column(String(20), nullable=False, default="pending", index=True)
    job_id = Column(String(100), unique=True)
    script_text = Column(Text)
    segment_count = Column(Integer, default=0)
    total_chars = Column(Integer, default=0)
    duration_seconds = Column(Integer, default=0)
    mp3_path = Column(String(500))
    srt_path = Column(String(500))
    error_message = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    completed_at = Column(DateTime)

    article = relationship("Article", back_populates="podcast_audio")
