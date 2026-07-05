#!/usr/bin/env bash
# Fails if any color literal (hex/rgb/hsl) exists in admin pages or components,
# excluding hex used as a var() fallback or inside color-mix().
set -euo pipefail

SRC=src
HITS=$(grep -rEn "#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(" \
  "$SRC/pages/admin" "$SRC/components/admin" \
  --include='*.ts' --include='*.tsx' --include='*.css' \
  | grep -vE 'var\([^)]*#[0-9a-fA-F]|color-mix[^,;)]*#[0-9a-fA-F]|// |^\s*\*' || true)

if [ -n "$HITS" ]; then
  echo "❌ Color literals found in admin code (use tokens instead):"
  echo "$HITS"
  exit 1
fi
echo "✅ No admin color literals"