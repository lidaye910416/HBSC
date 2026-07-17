#!/bin/sh
# Backend startup — installs deps then launches uvicorn.
# Designed for the deploy-service skill: runs inside python:3.11-slim base image.
set -e

cd "$(dirname "$0")"

# Use tuna mirror for both apt and pip — default repos are slow from CN datacenters
pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple 2>/dev/null || true
pip config set global.timeout 60 2>/dev/null || true

# Install runtime deps (pandoc needed by docx import route).
# Swap apt sources to a CN mirror before apt-get update to avoid the slow
# default deb.debian.org (can hang for >5 min on first build).
# Modern Debian uses /etc/apt/sources.list.d/debian.sources (DEB822 format)
# rather than /etc/apt/sources.list — handle both.
if command -v apt-get >/dev/null 2>&1; then
    if [ -f /etc/apt/sources.list ] && ! grep -q "tuna" /etc/apt/sources.list 2>/dev/null; then
        sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g; s|security.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list 2>/dev/null || true
    fi
    for f in /etc/apt/sources.list.d/*.sources; do
        [ -f "$f" ] || continue
        grep -q "tuna" "$f" 2>/dev/null && continue
        sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g; s|security.debian.org|mirrors.tuna.tsinghua.edu.cn|g' "$f" 2>/dev/null || true
    done
    apt-get update -qq && apt-get install -y --no-install-recommends pandoc \
        && rm -rf /var/lib/apt/lists/* || true
fi

# Install Python deps (idempotent — skip if already installed)
pip install --no-cache-dir -r requirements.txt

# Ensure uploads dir exists (seed covers come packaged in tar.gz)
mkdir -p uploads

# Run uvicorn
exec uvicorn app.main:app --host 0.0.0.0 --port 8000