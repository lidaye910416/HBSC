#!/usr/bin/env bash
# =============================================================================
# dev-down.sh — stop hubei-shuchuang dev env cleanly
#
# Kills the supervisor session first (if running) — this cascades SIGTERM
# to everything inside the screen window: dev-up.sh, uvicorn --reload, and
# the vite dev server. Then falls back to PID-file + port-based cleanup for
# the case where someone ran dev-up.sh without the supervisor.
# Safe to run multiple times.
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PID_DIR="$REPO_ROOT/.dev-pids"
BACKEND_PORT=8000
FRONTEND_PORT=5173
SESSION="hubei-dev"

log()  { printf "\033[1;36m[dev-down]\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m[dev-down]\033[0m %s\n" "$*" >&2; }

kill_pid() {
  local pid=$1 label=${2:-pid}
  if kill -0 "$pid" 2>/dev/null; then
    log "killing $label (pid=$pid)"
    kill "$pid" 2>/dev/null || true
    for _ in {1..10}; do
      kill -0 "$pid" 2>/dev/null || return 0
      sleep 0.2
    done
    warn "force-killing $label (pid=$pid) after 2s grace"
    kill -9 "$pid" 2>/dev/null || true
  fi
}

# Kill the supervisor session first — cascades to all child processes.
has_session() {
  { screen -ls "$1" 2>/dev/null || true; } \
    | awk -v s="$1" 'index($0, s) {print; exit}' | grep -q .
}
if command -v screen >/dev/null 2>&1 && has_session "$SESSION"; then
  log "killing supervisor session '$SESSION'"
  screen -S "$SESSION" -X quit 2>/dev/null || true
  # wait for the socket to disappear so the port-based fallback below sees reality
  for _ in {1..20}; do
    has_session "$SESSION" || break
    sleep 0.2
  done
  rm -f "$PID_DIR/supervisor.pid"
fi

# Kill via PID files first (preferred — exact match).
for pf in "$PID_DIR/uvicorn.pid" "$PID_DIR/vite.pid"; do
  if [[ -f "$pf" ]]; then
    pid=$(cat "$pf" 2>/dev/null || echo "")
    [[ -n "$pid" ]] && kill_pid "$pid" "$(basename "$pf" .pid)"
    rm -f "$pf"
  fi
done

# Fallback: any leftover listeners on our ports.
for port in "$BACKEND_PORT" "$FRONTEND_PORT"; do
  for pid in $(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true); do
    cmd=$(ps -p "$pid" -o command= 2>/dev/null || true)
    case "$cmd" in
      *"uvicorn app.main:app"*|*"$REPO_ROOT"*"node_modules/.bin/vite"*)
        warn "port :$port still has hubei process (pid=$pid); killing"
        kill_pid "$pid" "leftover"
        ;;
    esac
  done
done

log "done"
