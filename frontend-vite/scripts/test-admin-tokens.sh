#!/usr/bin/env bash
# Asserts admin-tokens.css has both dark + light theme blocks with required tokens.
set -euo pipefail

FILE=src/styles/admin-tokens.css
[ -f "$FILE" ] || { echo "❌ $FILE not found"; exit 1; }

# L1 brand atoms: only required in :root (these are inherited by all themes).
L1=(brand-ink brand-ink-2 brand-gold brand-gold-50 brand-gold-hover
    brand-gold-dark brand-gold-deep brand-paper-warm brand-cream)

# L2/L3 tokens: required in BOTH :root and :root[data-theme="light"].
L2L3=(surface-base surface-1 surface-2 border border-strong
      text-1 text-2 text-muted text-disabled text-inverse
      accent accent-soft
      status-published-bg status-published-fg
      status-draft-bg status-draft-fg
      status-archived-bg status-archived-fg status-featured-fg
      danger danger-bg)

fail=0

# Extract the :root { ... } block (dark defaults).
DARK_BLOCK=$(awk '/^:root[[:space:]]*\{/{flag=1} flag{print} /^\}/{if(flag){flag=0; exit}}' "$FILE")
# Extract the :root[data-theme="light"] { ... } block.
LIGHT_BLOCK=$(awk '/^:root\[data-theme="light"\][[:space:]]*\{/{flag=1} flag{print} /^\}/{if(flag){flag=0; exit}}' "$FILE")

if [ -z "$DARK_BLOCK" ]; then
  echo "❌ No :root { ... } block found in $FILE (dark theme missing)"
  fail=1
fi
if [ -z "$LIGHT_BLOCK" ]; then
  echo "❌ No :root[data-theme=\"light\"] { ... } block found in $FILE (light theme missing)"
  fail=1
fi

# L1 atoms: only check in :root.
for name in "${L1[@]}"; do
  if ! printf '%s\n' "$DARK_BLOCK" | grep -q -- "--$name:"; then
    echo "❌ :root missing L1 atom --$name"
    fail=1
  fi
done

# L2/L3 tokens: must appear in BOTH blocks.
for name in "${L2L3[@]}"; do
  if ! printf '%s\n' "$DARK_BLOCK" | grep -q -- "--$name:"; then
    echo "❌ Dark theme missing --$name"
    fail=1
  fi
  if ! printf '%s\n' "$LIGHT_BLOCK" | grep -q -- "--$name:"; then
    echo "❌ Light theme missing --$name"
    fail=1
  fi
done

if [ "$fail" -eq 0 ]; then
  echo "✅ admin-tokens.css has both themes with all required tokens"
fi
exit $fail