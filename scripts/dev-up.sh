#!/usr/bin/env bash
# =============================================================================
# dev-up.sh — Hubei-shuchuang dev environment bootstrap
#
# Solves the recurring "backend.run_server zombie" issue: another project on
# the machine keeps launching `python -m backend.run_server` on 0.0.0.0:8000
# and hijacking our port, which silently kills our hubei uvicorn and breaks
# the homepage (all useQueries 404 → journal content + AI FAB disappear).
#
# Workflow:
#   1. Detect any process on :8000 (backend) and :5173 (frontend).
#   2. If the process on :8000 is NOT ours (e.g. backend.run_server from
#      another project), kill it. Same for :5173.
#   3. Foreground uvicorn + vite (no nohup / disown / setsid / $! capture).
#      The supervisor script (dev-supervisor.sh) wraps this script in a
#      detached `screen` session; this script itself does NOT background.
#   4. Smoke test both endpoints. Exit non-zero on failure.
#
# Usage:
#   ./scripts/dev-up.sh            # start (idempotent — kills old first)
#   ./scripts/dev-up.sh --no-kill  # don't kill other processes (debug only)
#
# Pair with:
#   ./scripts/dev-supervisor.sh start  # recommended: detached + respawning
#   ./scripts/dev-down.sh              # stop everything (incl. supervisor)
#   ./scripts/dev-restart.sh           # stop + start
#   ./scripts/dev-status.sh            # check what's running
#   ./scripts/dev-logs.sh              # tail uvicorn + vite + supervisor logs
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PID_DIR="$REPO_ROOT/.dev-pids"
UVICORN_LOG="$REPO_ROOT/.dev-logs/uvicorn.log"
VITE_LOG="$REPO_ROOT/.dev-logs/vite.log"
BACKEND_PORT=8000
FRONTEND_PORT=5173
SMOKE_TIMEOUT=12

NO_KILL=0
FOREGROUND=0
[[ "${1:-}" == "--no-kill" ]] && NO_KILL=1
[[ "${1:-}" == "--foreground" || "${2:-}" == "--foreground" ]] && FOREGROUND=1

mkdir -p "$PID_DIR" "$REPO_ROOT/.dev-logs"

# Clear stale PID files from previous runs — the new server PIDs will be
# re-written below. Without this, dev-status.sh shows ghosts after a crash.
rm -f "$PID_DIR/uvicorn.pid" "$PID_DIR/vite.pid" "$PID_DIR/uvicorn.server.pid"

# --- helpers ----------------------------------------------------------------
log()  { printf "\033[1;36m[dev-up]\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m[dev-up]\033[0m %s\n" "$*" >&2; }
die()  { printf "\033[1;31m[dev-up]\033[0m %s\n" "$*" >&2; exit 1; }

# Returns PIDs listening on $1 (e.g. "8000") or empty. `lsof` exits 1
# when no matches — swallow that under `set -euo pipefail`.
pids_on_port() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | tr '\n' ' ' || true
}

# Returns the command (argv[0]+path) of PID $1, or "?" if gone.
pid_cmd() {
  ps -p "$1" -o command= 2>/dev/null | head -1 || echo "?"
}

is_hubei_process() {
  # Matches our backend (uvicorn running app.main:app from this repo)
  # and the frontend (vite from this repo's node_modules).
  local pid=$1 cmd
  cmd=$(pid_cmd "$pid")
  case "$cmd" in
    *"uvicorn app.main:app"*) return 0 ;;
    *"$REPO_ROOT"*"node_modules/.bin/vite"*) return 0 ;;
    *) return 1 ;;
  esac
}

kill_pid_gracefully() {
  local pid=$1 label=${2:-pid}
  if kill -0 "$pid" 2>/dev/null; then
    log "killing $label (pid=$pid): $(pid_cmd "$pid" | head -c 80)"
    kill "$pid" 2>/dev/null || true
    for _ in {1..10}; do
      kill -0 "$pid" 2>/dev/null || return 0
      sleep 0.2
    done
    warn "force-killing $label (pid=$pid) after 2s grace"
    kill -9 "$pid" 2>/dev/null || true
  fi
}

# Like `pids_on_port`, but ALSO confirms the listener is a real, live process
# whose command matches the expected argv pattern. Avoids the TIME_WAIT /
# stale-pid false positive where the port is unbound but lsof still shows a
# ghost, or a recycled PID no longer running uvicorn/vite.
lsof_retry_until() {
  local port=$1
  local pattern=$2  # e.g. "*uvicorn*" or "*node*vite*"
  local timeout=${3:-12}
  local deadline=$((SECONDS + timeout))
  while (( SECONDS < deadline )); do
    local pid
    pid=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      local cmd
      cmd=$(ps -p "$pid" -o command= 2>/dev/null || true)
      [[ "$cmd" == $pattern ]] && { echo "$pid"; return 0; }
    fi
    sleep 0.2
  done
  return 1
}

curl_with_retry() {
  # Retry transient connection failures (cold imports, slow startup) without
  # lying to the user about a real HTTP error. --fail-with-body surfaces the
  # body on a 4xx/5xx so we still see what went wrong.
  local tries=0 max=${RETRY_MAX:-3}
  while (( tries < max )); do
    if curl -fsS --max-time 4 "$@"; then return 0; fi
    tries=$((tries + 1))
    sleep 1
  done
  return 1
}

# --- preflight: clear port 8000 ---------------------------------------------
log "checking :$BACKEND_PORT (backend)"
existing=$(pids_on_port "$BACKEND_PORT")
if [[ -n "$existing" ]]; then
  if [[ $NO_KILL -eq 1 ]]; then
    die "port :$BACKEND_PORT is busy (pids: $existing); re-run without --no-kill"
  fi
  for pid in $existing; do
    if is_hubei_process "$pid"; then
      log "killing stale hubei uvicorn (pid=$pid)"
      kill_pid_gracefully "$pid" "hubei uvicorn"
    else
      warn "port :$BACKEND_PORT held by NON-hubei process (pid=$pid):"
      warn "    $(pid_cmd "$pid")"
      warn "    killing it — this is the 'backend.run_server zombie' scenario."
      kill_pid_gracefully "$pid" "zombie"
    fi
  done
  # final wait
  for _ in {1..10}; do
    [[ -z "$(pids_on_port "$BACKEND_PORT")" ]] && break
    sleep 0.2
  done
  [[ -n "$(pids_on_port "$BACKEND_PORT")" ]] && die "port :$BACKEND_PORT still busy after kill"
fi

# --- preflight: clear port 5173 ---------------------------------------------
log "checking :$FRONTEND_PORT (frontend)"
existing=$(pids_on_port "$FRONTEND_PORT")
if [[ -n "$existing" ]]; then
  if [[ $NO_KILL -eq 1 ]]; then
    die "port :$FRONTEND_PORT is busy (pids: $existing); re-run without --no-kill"
  fi
  for pid in $existing; do
    if is_hubei_process "$pid"; then
      log "killing stale hubei vite (pid=$pid)"
      kill_pid_gracefully "$pid" "hubei vite"
    else
      warn "port :$FRONTEND_PORT held by non-hubei process (pid=$pid): $(pid_cmd "$pid")"
      kill_pid_gracefully "$pid" "stranger"
    fi
  done
  for _ in {1..10}; do
    [[ -z "$(pids_on_port "$FRONTEND_PORT")" ]] && break
    sleep 0.2
  done
  [[ -n "$(pids_on_port "$FRONTEND_PORT")" ]] && die "port :$FRONTEND_PORT still busy after kill"
fi

# --- start servers in the foreground ----------------------------------------
# Two modes:
#   * Default (direct CLI): background the servers with &, run smoke tests,
#     print a summary, exit 0. Caller still has a usable shell. Children get
#     `nohup` so they survive the script exit; `disown` so the shell doesn't
#     track them for SIGHUP purposes.
#   * --foreground (used by dev-supervisor.sh): background both servers with
#     `&` (so this script can monitor both with `wait -n`), then block on
#     `wait` until either dies. No smoke tests (the supervisor respawns on
#     any exit anyway).
log "starting vite (port $FRONTEND_PORT)"
# `nohup` keeps children alive past script exit in detached mode; harmless in
# foreground (the supervisor still has a controlling TTY via the screen pty).
# Don't use `( ... exec nohup ... ) &` — subshell exit triggers SIGHUP to
# siblings on some shells, and the foreground branch needs the exact PIDs.
# Use pushd/popd to set cwd without subshell.
pushd "$REPO_ROOT/frontend-vite" >/dev/null
nohup ./node_modules/.bin/vite --port "$FRONTEND_PORT" --host 127.0.0.1 \
  </dev/null >>"$VITE_LOG" 2>&1 &
VITE_PID=$!
popd >/dev/null
disown "$VITE_PID" 2>/dev/null || true

log "starting uvicorn (port $BACKEND_PORT)"
pushd "$REPO_ROOT/backend" >/dev/null
nohup python3 -m uvicorn app.main:app --port "$BACKEND_PORT" --host 127.0.0.1 \
  </dev/null >>"$UVICORN_LOG" 2>&1 &
UVICORN_RELOADER_PID=$!
popd >/dev/null
disown "$UVICORN_RELOADER_PID" 2>/dev/null || true

# Informational PID files (dev-down kills the supervisor session, not these).
echo "$VITE_PID" > "$PID_DIR/vite.pid"
echo "$UVICORN_RELOADER_PID" > "$PID_DIR/uvicorn.pid"

if [[ $FOREGROUND -eq 1 ]]; then
  # Block until either server exits; propagate which one died so the
  # supervisor's log shows a useful message.
  # NOTE: `wait -n` is bash 4.3+; macOS ships bash 3.2.57. Poll instead.
  log "foreground mode: waiting for servers to exit (Ctrl-C in screen to stop)"
  while kill -0 "$VITE_PID" 2>/dev/null && kill -0 "$UVICORN_RELOADER_PID" 2>/dev/null; do
    sleep 1
  done
  if ! kill -0 "$VITE_PID" 2>/dev/null; then
    log "vite exited; stopping uvicorn"
  else
    log "uvicorn exited; stopping vite"
  fi
  kill "$VITE_PID" "$UVICORN_RELOADER_PID" 2>/dev/null || true
  wait "$VITE_PID" "$UVICORN_RELOADER_PID" 2>/dev/null || true
  log "foreground servers exited; supervisor will respawn"
  exit 1
fi

# --- detached mode: trap kills children on script exit (defensive) -----------
cleanup_on_exit() {
  kill "$VITE_PID" 2>/dev/null || true
  kill "$UVICORN_RELOADER_PID" 2>/dev/null || true
}
trap cleanup_on_exit EXIT

# --- wait for both -----------------------------------------------------------
log "waiting for backend to listen on :$BACKEND_PORT (timeout ${SMOKE_TIMEOUT}s)"
BACKEND_PID=$(lsof_retry_until "$BACKEND_PORT" "*uvicorn*" "$SMOKE_TIMEOUT") \
  || die "backend did not bind :$BACKEND_PORT within ${SMOKE_TIMEOUT}s; check $UVICORN_LOG"
echo "$BACKEND_PID" > "$PID_DIR/uvicorn.server.pid"

log "waiting for frontend to listen on :$FRONTEND_PORT (timeout ${SMOKE_TIMEOUT}s)"
lsof_retry_until "$FRONTEND_PORT" "*vite*" "$SMOKE_TIMEOUT" >/dev/null \
  || die "frontend did not bind :$FRONTEND_PORT within ${SMOKE_TIMEOUT}s; check $VITE_LOG"

# --- smoke test --------------------------------------------------------------
log "smoke test: GET /api/health"
curl_with_retry "http://127.0.0.1:$BACKEND_PORT/api/health" >/dev/null \
  || die "backend health check failed; check $UVICORN_LOG"
log "smoke test: GET /api/public/agent/config (FAB gate)"
curl_with_retry "http://127.0.0.1:$BACKEND_PORT/api/public/agent/config" >/dev/null \
  || die "agent config endpoint failed; check $UVICORN_LOG"
log "smoke test: GET / via vite proxy"
curl_with_retry "http://127.0.0.1:$FRONTEND_PORT/" >/dev/null \
  || die "frontend not serving; check $VITE_LOG"

# After smoke tests pass, clear the EXIT trap so the children survive the
# script's natural exit (otherwise the trap kills them).
trap - EXIT
disown "$VITE_PID" "$UVICORN_RELOADER_PID" 2>/dev/null || true

cat <<EOF

✅ hubei-shuchuang dev env is up.

  Backend  pid=$UVICORN_RELOADER_PID (reloader) / server pid=$BACKEND_PID  http://127.0.0.1:$BACKEND_PORT
  Frontend pid=$VITE_PID                                                   http://127.0.0.1:$FRONTEND_PORT

  Logs:  $UVICORN_LOG
         $VITE_LOG
  PIDs:  $PID_DIR  (informational; stop with ./scripts/dev-down.sh)

  Stop with:    ./scripts/dev-down.sh
  Restart with: ./scripts/dev-restart.sh
  Status with:  ./scripts/dev-status.sh

EOF
