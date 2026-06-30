from .articles_router import router as articles_router
from .team import router as team_router
from .auth_router import router as auth_router
from ..admin_router import router as admin_router
from .settings_router import router as settings_router
from .agent_router import router as agent_router
from .admin_articles_import import router as admin_articles_import_router
from .admin_articles_typeset import router as admin_articles_typeset_router

__all__ = [
    "articles_router",
    "team_router",
    "auth_router",
    "admin_router",
    "settings_router",
    "agent_router",
    "admin_articles_import_router",
    "admin_articles_typeset_router",
]
