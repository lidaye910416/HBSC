from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from .base import Base


class PodcastAudio(Base):
    __tablename__ = "podcast_audios"

    id = Column(Integer, primary_key=True, index=True)
    article_id = Column(Integer, ForeignKey("articles.id", ondelete="CASCADE"), unique=True, nullable=False, index=True)
    status = Column(String(20), nullable=False, default="pending", index=True)
    # Generation sub-stage surfaced to the UI so admin / readers can see
    # *where* the pipeline currently is. One of: pending / scripting /
    # synthesizing / muxing / ready / failed. Kept in sync with `status`
    # for the terminal states, but distinct while a job is in-flight.
    stage = Column(String(20), nullable=False, default="pending", index=True)
    # Integer 0–100. ``scripting`` and ``muxing`` are coarse-grained
    # (we don't expose the LLM's token progress, and ffmpeg is short);
    # ``synthesizing`` is per-segment and updated after every TTS call.
    progress = Column(Integer, nullable=False, default=0)
    # Wall-clock anchor for the "已耗时 X" + "预计还需 Y" counters the
    # admin list / editor card render. Reset on every regenerate.
    started_at = Column(DateTime)
    # Most recent successful run's duration — used to estimate the next
    # run's ETA from the first synthesized segment onward.
    last_successful_duration_seconds = Column(Integer, default=0)
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
