#!/usr/bin/env bash
# =============================================================================
# dev-status.sh — print a compact health summary of the dev env
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PID_DIR="$REPO_ROOT/.dev-pids"
BACKEND_PORT=8000
FRONTEND_PORT=5173

# Colors
G=$'\033[32m'  # green
R=$'\033[31m'  # red
Y=$'\033[33m'  # yellow
B=$'\033[36m'  # blue
N=$'\033[0m'   # reset

port_status() {
  local port=$1 name=$2
  local pids
  pids=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | tr '\n' ' ' | sed 's/ $//')
  if [[ -z "$pids" ]]; then
    printf "  %-12s ${R}DOWN${N}    (port :%d free)\n" "$name" "$port"
    return 1
  fi
  printf "  %-12s ${G}UP${N}      pid=%s  :%d\n" "$name" "$pids" "$port"
  return 0
}

endpoint() {
  local url=$1 name=$2
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "$url" 2>/dev/null || echo "000")
  local color=$R
  [[ "$code" =~ ^2 ]] && color=$G
  [[ "$code" =~ ^3 ]] && color=$Y
  printf "  %-32s ${color}%s${N}\n" "$name" "$code"
}

echo "${B}=== hubei-shuchuang dev status ===${N}"
echo
echo "Supervisor:"
SUP_LINE=$({ screen -ls "hubei-dev" 2>/dev/null || true; } \
           | awk -v s="hubei-dev" 'index($0, s) {print; exit}')
if command -v screen >/dev/null 2>&1 && [[ -n "$SUP_LINE" ]]; then
  SUP_PID=$(echo "$SUP_LINE" | awk '{print $1}' | cut -d. -f1)
  echo "$SUP_PID" > "$PID_DIR/supervisor.pid"
  printf "  ${G}UP${N}      session=hubei-dev  pid=%s\n" "$SUP_PID"
else
  rm -f "$PID_DIR/supervisor.pid"
  printf "  ${R}DOWN${N}\n"
fi

echo
echo "Ports:"
port_status "$BACKEND_PORT" "backend"  || true
port_status "$FRONTEND_PORT" "frontend" || true

echo
echo "Endpoints (via vite proxy :5173):"
endpoint "http://127.0.0.1:$FRONTEND_PORT/api/health"               "GET /api/health"
endpoint "http://127.0.0.1:$FRONTEND_PORT/api/issues"              "GET /api/issues"
endpoint "http://127.0.0.1:$FRONTEND_PORT/api/articles/featured"  "GET /api/articles/featured"
endpoint "http://127.0.0.1:$FRONTEND_PORT/api/team"                "GET /api/team"
endpoint "http://127.0.0.1:$FRONTEND_PORT/api/public/agent/config" "GET /api/public/agent/config (FAB gate)"
endpoint "http://127.0.0.1:$FRONTEND_PORT/"                        "GET / (homepage HTML)"

echo
echo "PID files:"
if [[ -d "$PID_DIR" ]]; then
  for f in "$PID_DIR"/*.pid; do
    [[ -f "$f" ]] || continue
    pid=$(cat "$f" 2>/dev/null || echo "?")
    printf "  %-20s pid=%s\n" "$(basename "$f")" "$pid"
  done
else
  echo "  (none — never started via dev-up.sh)"
fi

# Warn about zombie on 8000. The actual listener is the uvicorn --reload
# server worker (Python multiprocessing.spawn child of the reloader). The
# reloader itself is `uvicorn app.main:app`. So a process is "ours" if its
# own command contains that string OR its parent does.
zombie=""
is_hubei_cmd() {
  local c=${1:-}
  [[ "$c" == *"uvicorn app.main:app"* ]]
}
for pid in $(lsof -nP -iTCP:"$BACKEND_PORT" -sTCP:LISTEN -t 2>/dev/null || true); do
  cmd=$(ps -p "$pid" -o command= 2>/dev/null || true)
  ppid=$(ps -p "$pid" -o ppid= 2>/dev/null | tr -d ' ' || true)
  parent_cmd=""
  if [[ -n "$ppid" && "$ppid" != "1" ]]; then
    parent_cmd=$(ps -p "$ppid" -o command= 2>/dev/null || true)
  fi
  if ! is_hubei_cmd "$cmd" && ! is_hubei_cmd "$parent_cmd"; then
    zombie+="$pid "
  fi
done
if [[ -n "$zombie" ]]; then
  echo
  echo "${Y}⚠️  Port :$BACKEND_PORT is held by a non-hubei process.${N}"
  echo "    Run ${B}./scripts/dev-up.sh${N} to reclaim it."
fi

# Orphan warning: servers bound but supervisor gone.
if [[ -z "$SUP_LINE" ]]; then
  backend_up=$(lsof -nP -iTCP:"$BACKEND_PORT" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)
  frontend_up=$(lsof -nP -iTCP:"$FRONTEND_PORT" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)
  if [[ -n "$backend_up" || -n "$frontend_up" ]]; then
    echo
    echo "${Y}⚠️  Supervisor is DOWN but servers are still listening.${N}"
    echo "    This is an orphan — they will not auto-restart on crash."
    echo "    Run ${B}./scripts/dev-down.sh${N} then ${B}./scripts/dev-supervisor.sh start${N}."
  fi
fi
