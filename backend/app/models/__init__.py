from sqlalchemy.orm import declarative_base
Base = declarative_base()

from .journal import Journal, Article
from .researcher import Researcher
from .article_image import ArticleImage

__all__ = ["Base", "Journal", "Article", "Researcher", "ArticleImage"]