from sqlalchemy.orm import declarative_base
Base = declarative_base()

from .journal import Journal, Article
from .researcher import Researcher
from .article_image import ArticleImage
from .admin_setting import AdminSetting
from .podcast_audio import PodcastAudio

__all__ = ["Base", "Journal", "Article", "Researcher", "ArticleImage", "AdminSetting", "PodcastAudio"]
