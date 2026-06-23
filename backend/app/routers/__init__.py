from .articles_router import router as articles_router
from .team import router as team_router
from .auth_router import router as auth_router
from ..admin_router import router as admin_router

__all__ = ["articles_router", "team_router", "auth_router", "admin_router"]