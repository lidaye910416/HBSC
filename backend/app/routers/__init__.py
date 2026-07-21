from .articles_router import router as articles_router
from .team import router as team_router
from .auth_router import router as auth_router
from ..admin_router import router as admin_router
from .settings_router import router as settings_router
from .agent_router import router as agent_router
from .public_agent_router import router as public_agent_router
# NOTE: deliberately NOT re-exporting `public_podcast_router` here.
# Re-exporting it (as `from .public_podcast_router import router as
# public_podcast_router`) would set a package attribute with the same
# name as the submodule, which (a) makes `import app.routers.public_podcast_router`
# resolve to the APIRouter instance instead of the module file, and
# (b) breaks pytest's monkeypatch.setattr dotted-path resolution for the
# module-level helpers (`_minicast_post`, etc.) that tests need to mock.
# main.py imports the router via the dotted submodule path instead:
#     from .routers.public_podcast_router import router as public_podcast_router
from .admin_articles_import import router as admin_articles_import_router
from .admin_articles_typeset import router as admin_articles_typeset_router

__all__ = [
    "articles_router",
    "team_router",
    "auth_router",
    "admin_router",
    "settings_router",
    "agent_router",
    "public_agent_router",
    "admin_articles_import_router",
    "admin_articles_typeset_router",
]
