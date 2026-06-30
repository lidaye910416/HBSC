"""Admin: page-agent admin-side chat proxy has been removed (2026-06-30).

The connectivity probe under /api/admin/settings/{key}/test moved to
``settings_router``. This module is kept as a re-export shim so that
``app.routers.__init__`` need not change — it still imports ``router``
and ``main.py`` still calls ``include_router(agent_router)``; the empty
APIRouter simply registers zero routes.
"""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()

__all__: list[str] = ["router"]
