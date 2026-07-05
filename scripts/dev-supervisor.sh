#!/usr/bin/env bash
# =============================================================================
# dev-supervisor.sh — wraps dev-up.sh in a `screen` session that survives
# parent-shell exit, IDE close, terminal quit, and idle crashes.
#
# Why screen?
#   - Already installed on macOS at /usr/bin/screen — zero new deps.
#   - Detached session is its own session leader (replaces setsid + nohup +
#     disown + $! capture, all of which were broken in the previous design).
#   - Inherently inspectable: `screen -r hubei-dev` shows live logs and
#     allows interactive Ctrl-C during dev work.
#   - Built-in respawn: if dev-up.sh exits non-zero, screen respawns the
#     window shell (zombie=on, onerror=settings) until operator stops it.
#
# Outer modes (default --start):
#   ./scripts/dev-supervisor.sh start     # create + daemonize (idempotent)
#   ./scripts/dev-supervisor.sh stop      # kill the session (cascades)
#   ./scripts/dev-supervisor.sh status    # one-line UP/DOWN
#   ./scripts/dev-supervisor.sh attach    # foreground into the session
#
# Inner mode (--inner) — runs as the single foreground shell inside the
# screen window. Loops `dev-up.sh` with a 5s respawn delay.
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SESSION="hubei-dev"
LOG_DIR="$REPO_ROOT/.dev-logs"
PID_DIR="$REPO_ROOT/.dev-pids"
SUPERVISOR_LOG="$LOG_DIR/supervisor.log"
SUPERVISOR_PID_FILE="$PID_DIR/supervisor.pid"

mkdir -p "$LOG_DIR" "$PID_DIR"

# --- inner loop (executed inside the screen window) --------------------------
if [[ "${1:-}" == "--inner" ]]; then
  # timestamped tee (shell-based, no awk-strftime dep). Uses line-buffered
  # stdin reader that prepends `date +%T` to every line and `fflush`-equivalent
  # write to disk. Important: do NOT use `awk '{strftime(...)}'` here — macOS
  # BSD awk has no strftime; the awk subprocess crashes immediately, closing
  # the stdout pipe and SIGPIPE-killing the inner bash within milliseconds.
  ts_log() {
    while IFS= read -r line; do
      printf "[%s] %s\n" "$(date '+%Y-%m-%d %H:%M:%S')" "$line" >>"$SUPERVISOR_LOG"
    done
  }
  exec > >(ts_log) 2>&1

  echo "supervisor session '$SESSION' inner loop starting (pid=$$)"
  trap 'echo "supervisor inner loop exiting"; exit 0' INT TERM
  while :; do
    echo "=== launching dev-up.sh --foreground ==="
    "$REPO_ROOT/scripts/dev-up.sh" --foreground || echo "dev-up.sh --foreground exited $?"
    echo "=== dev-up.sh ended, sleeping 5s before respawn ==="
    sleep 5
  done
fi

# --- outer (operator-facing) -------------------------------------------------
# Portable session check (BSD grep on macOS doesn't support `\+` in BREs).
# Note: `screen -ls` exits 1 when the session exists (it prints "N Socket"
# diagnostics to stderr, last status), so the inner `|| true` is required
# under `set -e`.
has_session() {
  { screen -ls "$1" 2>/dev/null || true; } \
    | awk -v s="$1" 'index($0, s) {print; exit}' \
    | grep -q .
}

record_supervisor_pid() {
  # `screen -ls` prints "	12345.hubei-dev	(Detached)" — pull the PID.
  local pid
  pid=$({ screen -ls "$SESSION" 2>/dev/null || true; } \
        | awk -v s="$SESSION" 'index($0, s) {print $1; exit}' | cut -d. -f1)
  if [[ -n "$pid" ]]; then
    echo "$pid" > "$SUPERVISOR_PID_FILE"
  else
    rm -f "$SUPERVISOR_PID_FILE"
  fi
}

case "${1:-start}" in
  start)
    if has_session "$SESSION"; then
      echo "supervisor session '$SESSION' already running"
      record_supervisor_pid
    else
      screen -dmS "$SESSION" "$REPO_ROOT/scripts/dev-supervisor.sh" --inner
      # give screen a moment to fork before reading -ls
      sleep 0.3
      record_supervisor_pid
      echo "supervisor started; logs: $SUPERVISOR_LOG"
      echo "attach:    ./scripts/dev-supervisor.sh attach"
      echo "stop:      ./scripts/dev-supervisor.sh stop"
      echo "status:    ./scripts/dev-supervisor.sh status"
    fi
    ;;

  stop)
    if has_session "$SESSION"; then
      screen -S "$SESSION" -X quit
      # screen -X quit is async; wait for the session socket to disappear.
      for _ in {1..20}; do
        has_session "$SESSION" || break
        sleep 0.2
      done
      rm -f "$SUPERVISOR_PID_FILE"
      echo "supervisor stopped"
    else
      echo "supervisor not running"
      rm -f "$SUPERVISOR_PID_FILE"
    fi
    ;;

  status)
    if has_session "$SESSION"; then
      record_supervisor_pid
      local_pid=$(cat "$SUPERVISOR_PID_FILE" 2>/dev/null || echo "?")
      echo "supervisor: UP  session=$SESSION  pid=$local_pid"
    else
      rm -f "$SUPERVISOR_PID_FILE"
      echo "supervisor: DOWN"
    fi
    ;;

  attach)
    if has_session "$SESSION"; then
      exec screen -r "$SESSION"
    else
      echo "supervisor not running; start with: ./scripts/dev-supervisor.sh start"
      exit 1
    fi
    ;;

  restart)
    "$0" stop || true
    "$0" start
    ;;

  *)
    echo "usage: $0 {start|stop|status|attach|restart}" >&2
    exit 2
    ;;
esac