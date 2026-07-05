#!/usr/bin/env bash
# dev-logs.sh — tail uvicorn + vite + supervisor logs side by side
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec tail -F \
  "$REPO_ROOT/.dev-logs/uvicorn.log" \
  "$REPO_ROOT/.dev-logs/vite.log" \
  "$REPO_ROOT/.dev-logs/supervisor.log"