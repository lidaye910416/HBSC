#!/usr/bin/env bash
# dev-restart.sh — down + up (via supervisor, so detached + respawning)
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
"$REPO_ROOT/scripts/dev-down.sh"
exec "$REPO_ROOT/scripts/dev-supervisor.sh" start