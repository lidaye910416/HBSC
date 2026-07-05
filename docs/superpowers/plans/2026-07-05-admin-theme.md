# Admin Theme System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all admin color literals with token-based theming; ship a dark-default + light-toggleable admin that visually echoes the public site's brand identity, without any backend or public-site changes.

**Architecture:** Three-tier token system (brand atoms → semantic roles → status) defined once in `admin-tokens.css` with two CSS blocks (`:root` = dark default, `:root[data-theme="light"]` = light opt-in). Three JS touch-points (main.tsx inline, AdminLayout init, AdminSettings toggle) flip the `data-theme` attribute and persist to localStorage. No React Context, no per-component theming.

**Tech Stack:** CSS custom properties, React 19, TypeScript, Playwright (existing visual regression infra at `frontend-vite/tests/`).

**Spec:** `docs/superpowers/specs/2026-07-05-admin-theme-design.md`

---

## File Structure

| File | Role | Action |
|---|---|---|
| `frontend-vite/src/styles/admin-tokens.css` | Theme tokens (3-tier + dual scope) | Rewrite |
| `frontend-vite/src/main.tsx` | FOUC-prevention inline script | Edit |
| `frontend-vite/src/components/admin/AdminLayout.tsx` | Theme init sync from localStorage | Edit |
| `frontend-vite/src/pages/admin/AdminSettings.tsx` | Appearance card UI | Edit |
| `frontend-vite/src/pages/admin/AdminSettings.css` | Appearance card styles | Edit |
| `frontend-vite/src/pages/admin/Login.css` | `white` literal → token | Edit |
| `frontend-vite/src/pages/admin/Dashboard.css` | `rgba(26,26,46,0.6)` → token | Edit |
| `frontend-vite/src/pages/admin/ArticleList.css` | `#ffffff` + rgba → token | Edit |
| `frontend-vite/src/pages/admin/ArticleList.tsx` | status-pill inline styles → token | Edit |
| `frontend-vite/src/pages/admin/ArticleEditor.tsx` | `#d97706` → token | Edit |
| `frontend-vite/src/pages/admin/JournalList.tsx` | completeness badge → token | Edit |
| `frontend-vite/src/pages/admin/JournalDetail.css` | verify + rgba cleanup | Edit |
| `frontend-vite/src/pages/admin/Toast.css` | `rgba(0,0,0,0.08)` → `--shadow-2` | Edit |
| `frontend-vite/src/components/admin/TypesetPreviewDialog.tsx` | `#C9A84C` → `--brand-gold` | Edit |
| `frontend-vite/src/components/admin/TypesetPreviewDialog.css` | `#C9A84C` × 3 → `--brand-gold` | Edit |
| `frontend-vite/src/components/admin/Mde/inlineImageEdit.tsx` | `#C9A84C` × 2 → `--brand-gold` | Edit |
| `frontend-vite/src/components/admin/Mde/inlineTableEdit.tsx` | `#C9A84C`, `#FFFBEF` → token | Edit |
| `frontend-vite/scripts/scan-admin-literals.sh` | NEW — literal-scan test | Create |
| `frontend-vite/scripts/test-admin-tokens.sh` | NEW — token contract test | Create |
| `frontend-vite/scripts/README.md` | NEW — explain scripts dir | Create |
| `frontend-vite/package.json` | add `lint:admin-tokens` + `test:tokens` | Edit |
| `frontend-vite/tests/admin-theme.spec.ts` | NEW — playwright theme toggle + persistence | Create |
| `frontend-vite/tests/admin-snapshots.spec.ts-snapshots/*` | Existing snapshots to regenerate | Re-record |

Public-site files (Home / Articles / Cases / Insights / About / Search / etc.) — **no changes**.

---

## Task 1: Add token contract test (failing)

**Files:**
- Create: `frontend-vite/scripts/test-admin-tokens.sh`
- Create: `frontend-vite/scripts/README.md`
- Modify: `frontend-vite/package.json`

- [ ] **Step 1: Create the scripts directory with a README**

Create `frontend-vite/scripts/README.md`:

```markdown
# frontend-vite/scripts

Local helper scripts for the frontend.

- `scan-admin-literals.sh` — fails if any hex/rgb/hsl literal lives in admin pages or components (excludes token declarations).
- `test-admin-tokens.sh` — asserts `admin-tokens.css` defines both dark (`:root`) and light (`:root[data-theme="light"]`) blocks with all expected token names.

Run via `npm run lint:admin-tokens` and `npm run test:tokens` from `frontend-vite/`.
```

- [ ] **Step 2: Write the failing token contract test**

Create `frontend-vite/scripts/test-admin-tokens.sh`:

```bash
#!/usr/bin/env bash
# Asserts admin-tokens.css has both dark + light theme blocks with required tokens.
set -e

FILE=src/styles/admin-tokens.css
[ -f "$FILE" ] || { echo "❌ $FILE not found"; exit 1; }

# Required token names that must appear in BOTH the dark (:root) and light blocks.
REQUIRED=(
  surface-base surface-1 surface-2 border
  text-1 text-2 text-muted
  accent accent-soft
  status-published-bg status-published-fg
  status-draft-bg status-draft-fg
  status-archived-bg status-archived-fg
  status-featured-fg
  danger danger-bg
  brand-ink brand-gold
)

fail=0

# Extract the :root { ... } block (dark defaults).
DARK_BLOCK=$(awk '/^:root\s*\{/{flag=1} flag{print} /^\}/{if(flag){flag=0; exit}}' "$FILE")
# Extract the :root[data-theme="light"] { ... } block.
LIGHT_BLOCK=$(awk '/^:root\[data-theme="light"\]\s*\{/{flag=1} flag{print} /^\}/{if(flag){flag=0; exit}}' "$FILE")

if [ -z "$DARK_BLOCK" ]; then
  echo "❌ No :root { ... } block found in $FILE (dark theme missing)"
  fail=1
fi
if [ -z "$LIGHT_BLOCK" ]; then
  echo "❌ No :root[data-theme=\"light\"] { ... } block found in $FILE (light theme missing)"
  fail=1
fi

for name in "${REQUIRED[@]}"; do
  if [ -n "$DARK_BLOCK" ] && ! grep -q -- "--$name:" <<< "$DARK_BLOCK"; then
    echo "❌ Dark theme missing --$name"
    fail=1
  fi
  if [ -n "$LIGHT_BLOCK" ] && ! grep -q -- "--$name:" <<< "$LIGHT_BLOCK"; then
    echo "❌ Light theme missing --$name"
    fail=1
  fi
done

if [ "$fail" -eq 0 ]; then
  echo "✅ admin-tokens.css has both themes with all required tokens"
fi
exit $fail
```

- [ ] **Step 3: Make script executable**

Run: `chmod +x frontend-vite/scripts/test-admin-tokens.sh`

- [ ] **Step 4: Add npm scripts**

Edit `frontend-vite/package.json` `scripts` block to add:

```json
"test:tokens": "bash scripts/test-admin-tokens.sh",
"lint:admin-tokens": "bash scripts/scan-admin-literals.sh"
```

(The `scan-admin-literals.sh` file doesn't exist yet — that's Task 2; npm will error if you run `lint:admin-tokens` before then. Add both now so we don't re-edit package.json later.)

- [ ] **Step 5: Run the test to verify it fails**

Run: `cd frontend-vite && npm run test:tokens`

Expected: exit code 1, output includes `❌ Dark theme missing --surface-base` (and many others) because the current `admin-tokens.css` uses `--admin-bg` etc., not `--surface-base`.

- [ ] **Step 6: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang
git add frontend-vite/scripts/ frontend-vite/package.json frontend-vite/package-lock.json
git commit -m "test(admin): add token contract test for dark + light themes (failing)"
```

---

## Task 2: Add literal-scan test (failing)

**Files:**
- Create: `frontend-vite/scripts/scan-admin-literals.sh`

- [ ] **Step 1: Write the failing literal-scan script**

Create `frontend-vite/scripts/scan-admin-literals.sh`:

```bash
#!/usr/bin/env bash
# Fails if any color literal (hex/rgb/hsl) exists in admin pages or components,
# excluding declarations inside admin-tokens.css and color-mix() expressions.
set -e

SRC=src
HITS=$(grep -rEn "#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(" \
  "$SRC/pages/admin" "$SRC/components/admin" \
  --include='*.ts' --include='*.tsx' --include='*.css' \
  | grep -vE "var\(--|color-mix|// |^\s*\*" || true)

if [ -n "$HITS" ]; then
  echo "❌ Color literals found in admin code (use tokens instead):"
  echo "$HITS"
  exit 1
fi
echo "✅ No admin color literals"
```

- [ ] **Step 2: Make executable**

Run: `chmod +x frontend-vite/scripts/scan-admin-literals.sh`

- [ ] **Step 3: Run to verify it fails**

Run: `cd frontend-vite && npm run lint:admin-tokens`

Expected: exit code 1, output lists ~18 literal occurrences across Login.css, Dashboard.css, ArticleList.css, ArticleList.tsx, ArticleEditor.tsx, JournalList.tsx, AdminSettings.css, Toast.css, TypesetPreviewDialog.css, Mde/inlineImageEdit.tsx, Mde/inlineTableEdit.tsx.

- [ ] **Step 4: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang
git add frontend-vite/scripts/scan-admin-literals.sh
git commit -m "test(admin): add literal-scan test for admin pages + components (failing)"
```

---

## Task 3: Refactor admin-tokens.css to three-tier (dark default)

**Files:**
- Modify: `frontend-vite/src/styles/admin-tokens.css` (full rewrite)

- [ ] **Step 1: Write the new admin-tokens.css**

Replace the entire contents of `frontend-vite/src/styles/admin-tokens.css` with:

```css
/* Admin Design Tokens — 仅在 admin scope 用，不污染公开站。
 * 三层结构：
 *   L1 品牌原子  ── 两主题共用，不变
 *   L2 语义角色  ── 按主题切换，定义 :root（暗色默认）和 :root[data-theme="light"]（浅色）
 *   L3 状态/风险 ── 按主题提供双值
 *
 * 同时保留旧名（--admin-* / --brand-*）作为别名，向后兼容已有代码。
 */

:root {
  /* ===== L1 · 品牌原子（双主题共用） ===== */
  --brand-ink: #1A1A2E;
  --brand-ink-2: #16213E;
  --brand-gold: #C9A84C;
  --brand-gold-50: #F5EEDC;
  --brand-gold-hover: #B89740;
  --brand-gold-dark: #a07f2c;
  --brand-gold-deep: #6e5b29;
  --brand-paper-warm: #F5F0E8;
  --brand-cream: #FAFAF7;

  /* ===== L2 · 语义角色 · DARK（默认） ===== */
  --surface-base: #1A1A2E;
  --surface-1:    #232536;
  --surface-2:    #2D2F45;
  --border:       #2D2F45;
  --border-strong: #4A4D6A;
  --text-1:       #FAFAF7;
  --text-2:       #C8C8D0;
  --text-muted:   #8C8C9A;
  --text-disabled: #6B6B82;
  --text-inverse: #FAFAF7;
  --accent:       var(--brand-gold);
  --accent-soft:  rgba(201, 168, 76, 0.18);

  /* ===== L3 · 状态/风险 · DARK ===== */
  --status-published-bg: rgba(232, 244, 234, 0.12);
  --status-published-fg: #A8D5AC;
  --status-draft-bg:     rgba(244, 241, 232, 0.12);
  --status-draft-fg:     #D4C896;
  --status-archived-bg:  rgba(240, 239, 234, 0.10);
  --status-archived-fg:  #C8C8D0;
  --status-featured-fg:  #C9A84C;
  --danger:              #E07B7B;
  --danger-bg:           rgba(224, 123, 123, 0.15);
  --danger-border:       rgba(224, 123, 123, 0.4);

  /* ===== 别名 · 向后兼容 ===== */
  --admin-bg:        var(--surface-base);
  --admin-surface:   var(--surface-1);
  --admin-surface-2: var(--surface-2);
  --admin-border:    var(--border);
  --admin-text:      var(--text-1);
  --admin-text-2:    var(--text-2);
  --admin-text-muted: var(--text-muted);

  /* ===== 排版与间距（不变） ===== */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;
  --space-8: 64px;

  --radius-1: 4px;
  --radius-2: 6px;
  --radius-3: 10px;

  --shadow-1: 0 1px 2px rgba(0, 0, 0, 0.30);
  --shadow-2: 0 4px 16px rgba(0, 0, 0, 0.40);
  --shadow-focus: 0 0 0 3px rgba(201, 168, 76, 0.35);

  --type-xs: 12px;
  --type-sm: 13px;
  --type-base: 14px;
  --type-md: 16px;
  --type-lg: 20px;
  --type-xl: 28px;
  --type-display: 36px;

  --sidebar-width: 240px;
  --header-height: 64px;
  --content-max: 1280px;
}

:root[data-theme="light"] {
  /* ===== L2 · 语义角色 · LIGHT ===== */
  --surface-base: #FAFAF7;
  --surface-1:    #FFFFFF;
  --surface-2:    #F5F4EE;
  --border:       #E8E5DC;
  --border-strong: #D4D0C4;
  --text-1:       #1A1A2E;
  --text-2:       #5C5C68;
  --text-muted:   #8C8C9A;
  --text-disabled: #4b4b62;
  --text-inverse: #FAFAF7;
  --accent:       var(--brand-gold);
  --accent-soft:  #F5EEDC;

  /* ===== L3 · 状态/风险 · LIGHT ===== */
  --status-published-bg: #E8F4EA;
  --status-published-fg: #1B5E20;
  --status-draft-bg:     #F4F1E8;
  --status-draft-fg:     #8C7A3E;
  --status-archived-bg:  #F0EFEA;
  --status-archived-fg:  #5C5C68;
  --status-featured-fg:  #8C6F1F;
  --danger:              #B04040;
  --danger-bg:           #F8E6E6;
  --danger-border:       rgba(176, 64, 64, 0.4);

  /* ===== LIGHT 主题专属阴影（与 dark 区分） ===== */
  --shadow-1: 0 1px 2px rgba(26, 26, 46, 0.04);
  --shadow-2: 0 4px 16px rgba(26, 26, 46, 0.06);
  --shadow-focus: 0 0 0 3px rgba(201, 168, 76, 0.25);
}
```

- [ ] **Step 2: Run token contract test — should still fail (no light block tokens missing for some, but mostly pass)**

Run: `cd frontend-vite && npm run test:tokens`

Expected: exit code 1, listing every `REQUIRED` token missing from the light block (e.g. `❌ Light theme missing --brand-ink`, `❌ Light theme missing --brand-gold`). The dark block should pass all checks.

- [ ] **Step 3: Run literal-scan — still fails on other files**

Run: `cd frontend-vite && npm run lint:admin-tokens`

Expected: exit 1 with the same ~18 hits as before.

- [ ] **Step 4: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang
git add frontend-vite/src/styles/admin-tokens.css
git commit -m "refactor(admin): 3-tier token system with dark default + light overrides"
```

---

## Task 4: Verify token contract test passes after Task 3 refactor

**Files:** none (verification task)

- [ ] **Step 1: Inspect the test output**

Re-run: `cd frontend-vite && npm run test:tokens`

Expected: still fails because `:root[data-theme="light"]` does NOT redeclare `--brand-ink`, `--brand-gold`, etc. (those are L1 brand atoms, only declared in `:root`).

- [ ] **Step 2: Adjust the test to only require L2/L3 tokens in BOTH blocks**

Edit `frontend-vite/scripts/test-admin-tokens.sh` — split REQUIRED into two arrays:

```bash
# L1 brand atoms: only required in :root
L1=(brand-ink brand-ink-2 brand-gold brand-gold-50 brand-gold-hover
    brand-gold-dark brand-gold-deep brand-paper-warm brand-cream)

# L2/L3 tokens: required in BOTH :root and :root[data-theme="light"]
L2L3=(surface-base surface-1 surface-2 border border-strong
      text-1 text-2 text-muted text-disabled text-inverse
      accent accent-soft
      status-published-bg status-published-fg
      status-draft-bg status-draft-fg
      status-archived-bg status-archived-fg status-featured-fg
      danger danger-bg)

for name in "${L1[@]}"; do
  if ! grep -q -- "--$name:" <<< "$DARK_BLOCK"; then
    echo "❌ :root missing L1 atom --$name"; fail=1
  fi
done
for name in "${L2L3[@]}"; do
  if ! grep -q -- "--$name:" <<< "$DARK_BLOCK"; then
    echo "❌ Dark theme missing --$name"; fail=1
  fi
  if ! grep -q -- "--$name:" <<< "$LIGHT_BLOCK"; then
    echo "❌ Light theme missing --$name"; fail=1
  fi
done
```

- [ ] **Step 3: Re-run test**

Run: `cd frontend-vite && npm run test:tokens`

Expected: exit 0, output `✅ admin-tokens.css has both themes with all required tokens`.

- [ ] **Step 4: Commit the test tweak**

```bash
cd /Users/jasonlee/hubei-shuchuang
git add frontend-vite/scripts/test-admin-tokens.sh
git commit -m "test(admin): split token contract into L1 atoms vs L2/L3 dual-scope"
```

---

## Task 5: Replace literals in Login.css + Dashboard.css

**Files:**
- Modify: `frontend-vite/src/pages/admin/Login.css`
- Modify: `frontend-vite/src/pages/admin/Dashboard.css`

- [ ] **Step 1: Edit Login.css**

In `frontend-vite/src/pages/admin/Login.css`, change line 10:

```diff
 .admin-login__card {
-  background: white;
+  background: var(--surface-1);
   padding: 48px;
   border-radius: 8px;
   box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
```

- [ ] **Step 2: Edit Dashboard.css**

In `frontend-vite/src/pages/admin/Dashboard.css`, change line 79:

```diff
 .dashboard__media-item__name {
   position: absolute;
   bottom: 0; left: 0; right: 0;
   padding: 4px 6px;
-  background: rgba(26, 26, 46, 0.6);
+  background: color-mix(in srgb, var(--brand-ink) 60%, transparent);
   color: white;
```

- [ ] **Step 3: Run literal-scan**

Run: `cd frontend-vite && npm run lint:admin-tokens`

Expected: still fails with fewer hits (the 2 we just fixed are gone).

- [ ] **Step 4: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang
git add frontend-vite/src/pages/admin/Login.css frontend-vite/src/pages/admin/Dashboard.css
git commit -m "refactor(admin): Login + Dashboard use surface + brand-ink tokens"
```

---

## Task 6: Replace literals in ArticleList.css + ArticleList.tsx

**Files:**
- Modify: `frontend-vite/src/pages/admin/ArticleList.css`
- Modify: `frontend-vite/src/pages/admin/ArticleList.tsx`

- [ ] **Step 1: Edit ArticleList.css line 205**

```diff
-  background: #ffffff;
+  background: var(--surface-1);
```

And line 190 (rgba gold border):

```diff
-  border: 1px solid rgba(201, 168, 76, 0.35);
+  border: 1px solid color-mix(in srgb, var(--brand-gold) 35%, transparent);
```

- [ ] **Step 2: Edit ArticleList.tsx status-pill inline styles**

Find the status pill inline `style={{ background: ..., color: ... }}` (search for `#E8F4EA` or `published`). Replace each status pill block with:

```tsx
style={{
  fontSize: 'var(--type-xs)',
  padding: '2px 8px',
  borderRadius: 999,
  background: status === 'published' ? 'var(--status-published-bg)' :
              status === 'draft'     ? 'var(--status-draft-bg)' :
                                       'var(--status-archived-bg)',
  color:      status === 'published' ? 'var(--status-published-fg)' :
              status === 'draft'     ? 'var(--status-draft-fg)' :
                                       'var(--status-archived-fg)',
  fontWeight: 500,
}}
```

If the existing code uses a different control-flow shape (ternary already exists), only swap the hex values for the `var(--status-*)` tokens — don't restructure.

- [ ] **Step 3: Run literal-scan**

Run: `cd frontend-vite && npm run lint:admin-tokens`

Expected: still failing, fewer hits.

- [ ] **Step 4: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang
git add frontend-vite/src/pages/admin/ArticleList.css frontend-vite/src/pages/admin/ArticleList.tsx
git commit -m "refactor(admin): ArticleList pills use status tokens"
```

---

## Task 7: Replace literals in ArticleEditor.tsx

**Files:**
- Modify: `frontend-vite/src/pages/admin/ArticleEditor.tsx`

- [ ] **Step 1: Find and replace `#d97706`**

Run: `grep -n "#d97706\|color-text-secondary" frontend-vite/src/pages/admin/ArticleEditor.tsx`

Replace each `#d97706` with `var(--status-draft-fg)`.

Replace each `var(--color-text-secondary)` with `var(--admin-text-2)`.

- [ ] **Step 2: Run literal-scan**

Run: `cd frontend-vite && npm run lint:admin-tokens`

Expected: still failing, fewer hits.

- [ ] **Step 3: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang
git add frontend-vite/src/pages/admin/ArticleEditor.tsx
git commit -m "refactor(admin): ArticleEditor uses status-draft + admin-text-2 tokens"
```

---

## Task 8: Replace literals in JournalList.tsx + JournalDetail.css

**Files:**
- Modify: `frontend-vite/src/pages/admin/JournalList.tsx`
- Modify: `frontend-vite/src/pages/admin/JournalDetail.css`

- [ ] **Step 1: Edit JournalList.tsx lines 137-138**

```diff
                            style={{
                              fontSize: 'var(--type-xs)',
                              padding: '1px 8px',
                              borderRadius: 999,
-                             background: completeness[j.id].complete ? '#E8F4EA' : '#F4F1E8',
-                             color: completeness[j.id].complete ? '#1B5E20' : '#8C7A3E',
+                             background: completeness[j.id].complete
+                               ? 'var(--status-published-bg)'
+                               : 'var(--status-draft-bg)',
+                             color: completeness[j.id].complete
+                               ? 'var(--status-published-fg)'
+                               : 'var(--status-draft-fg)',
                              fontWeight: 500,
                            }}
```

- [ ] **Step 2: Verify JournalDetail.css**

Run: `grep -nE "#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(" frontend-vite/src/pages/admin/JournalDetail.css | grep -v "var(--" | grep -v "color-mix"`

If any non-token color literal exists (excluding `color-mix` and `var(--...)`), replace with appropriate token. Otherwise no change.

- [ ] **Step 3: Run literal-scan**

Run: `cd frontend-vite && npm run lint:admin-tokens`

Expected: still failing, fewer hits.

- [ ] **Step 4: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang
git add frontend-vite/src/pages/admin/JournalList.tsx frontend-vite/src/pages/admin/JournalDetail.css
git commit -m "refactor(admin): JournalList completeness badges use status tokens"
```

---

## Task 9: Replace literals in AdminSettings.css + Toast.css + TypesetPreviewDialog

**Files:**
- Modify: `frontend-vite/src/pages/admin/AdminSettings.css`
- Modify: `frontend-vite/src/components/admin/Toast.css`
- Modify: `frontend-vite/src/components/admin/TypesetPreviewDialog.tsx`
- Modify: `frontend-vite/src/components/admin/TypesetPreviewDialog.css`

- [ ] **Step 1: AdminSettings.css — replace `#fff` and rgba**

Lines 412, 420: replace `#fff` with `var(--surface-1)`.

Lines 414, 516-518: replace `rgba(0, 0, 0, ...)` shadows with `var(--shadow-1)` / `var(--shadow-2)` where appropriate.

- [ ] **Step 2: Toast.css line 22**

```diff
-  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
+  box-shadow: var(--shadow-2);
```

- [ ] **Step 3: TypesetPreviewDialog.tsx — replace any `#C9A84C` with `var(--brand-gold)`**

Run: `grep -n "#C9A84C" frontend-vite/src/components/admin/TypesetPreviewDialog.tsx`

Replace each occurrence.

- [ ] **Step 4: TypesetPreviewDialog.css lines 20-21, 68**

```diff
-  background: color-mix(in srgb, #C9A84C 12%, transparent);
-  border-left: 3px solid #C9A84C;
+  background: color-mix(in srgb, var(--brand-gold) 12%, transparent);
+  border-left: 3px solid var(--brand-gold);
```

```diff
-  background: color-mix(in srgb, #C9A84C 8%, transparent);
+  background: color-mix(in srgb, var(--brand-gold) 8%, transparent);
```

- [ ] **Step 5: Run literal-scan**

Run: `cd frontend-vite && npm run lint:admin-tokens`

Expected: still failing, fewer hits.

- [ ] **Step 6: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang
git add frontend-vite/src/pages/admin/AdminSettings.css frontend-vite/src/components/admin/Toast.css frontend-vite/src/components/admin/TypesetPreviewDialog.tsx frontend-vite/src/components/admin/TypesetPreviewDialog.css
git commit -m "refactor(admin): AdminSettings + Toast + TypesetPreview use tokens"
```

---

## Task 10: Replace literals in Mde/inlineImageEdit.tsx + Mde/inlineTableEdit.tsx

**Files:**
- Modify: `frontend-vite/src/components/admin/Mde/inlineImageEdit.tsx`
- Modify: `frontend-vite/src/components/admin/Mde/inlineTableEdit.tsx`

- [ ] **Step 1: Edit inlineImageEdit.tsx**

Replace each `#C9A84C` with `var(--brand-gold)` (lines ~57 and ~69).

- [ ] **Step 2: Edit inlineTableEdit.tsx**

Line ~49: `#C9A84C` → `var(--brand-gold)`.

Other literals: `#FFFBEF` → `var(--brand-paper-warm)`.

- [ ] **Step 3: Run literal-scan — should now pass**

Run: `cd frontend-vite && npm run lint:admin-tokens`

Expected: exit 0, `✅ No admin color literals`.

- [ ] **Step 4: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang
git add frontend-vite/src/components/admin/Mde/inlineImageEdit.tsx frontend-vite/src/components/admin/Mde/inlineTableEdit.tsx
git commit -m "refactor(admin): Mde inline editors use brand-gold + paper-warm tokens"
```

---

## Task 11: Add FOUC-prevention inline script in main.tsx

**Files:**
- Modify: `frontend-vite/src/main.tsx`

- [ ] **Step 1: Read main.tsx**

Run: `cat frontend-vite/src/main.tsx`

- [ ] **Step 2: Insert the inline pre-mount script**

Edit the file so the `<script>` tag appears **before** `<React.StrictMode>`. Final shape:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// FOUC-prevention: set theme attribute on <html> before React mounts.
// This avoids a flash of the default (dark) theme when the user picked light.
const saved = (() => {
  try { return localStorage.getItem('hbsc-theme') } catch { return null }
})()
if (saved === 'light') document.documentElement.dataset.theme = 'light'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 3: Verify build still passes**

Run: `cd frontend-vite && npm run build`

Expected: build succeeds with no TS errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang
git add frontend-vite/src/main.tsx
git commit -m "feat(admin): FOUC-prevention theme init in main.tsx"
```

---

## Task 12: Add theme sync useEffect in AdminLayout.tsx

**Files:**
- Modify: `frontend-vite/src/components/admin/AdminLayout.tsx`

- [ ] **Step 1: Read AdminLayout.tsx imports and component**

The file already imports `useEffect`. The current effect for `pageEnterAnimation` runs on `[location.pathname]`. Add a new effect right after it.

- [ ] **Step 2: Add the theme-sync useEffect**

After the existing `useEffect(() => { ... }, [location.pathname])` block, add:

```tsx
useEffect(() => {
  // Sync data-theme attribute from localStorage (defensive — main.tsx already
  // sets it pre-mount, but a stale value can drift if the user toggles in
  // another tab).
  const saved = (() => {
    try { return localStorage.getItem('hbsc-theme') } catch { return null }
  })()
  document.documentElement.dataset.theme = saved === 'light' ? 'light' : ''
}, [])
```

- [ ] **Step 3: Verify build**

Run: `cd frontend-vite && npm run build`

Expected: passes.

- [ ] **Step 4: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang
git add frontend-vite/src/components/admin/AdminLayout.tsx
git commit -m "feat(admin): AdminLayout syncs theme attribute from localStorage"
```

---

## Task 13: Add AppearanceCard to AdminSettings.tsx + .css

**Files:**
- Modify: `frontend-vite/src/pages/admin/AdminSettings.tsx`
- Modify: `frontend-vite/src/pages/admin/AdminSettings.css`

- [ ] **Step 1: Read AdminSettings.tsx to find the existing card pattern**

Locate the existing Card-based settings UI and identify the pattern used (e.g. a `<Card title="...">` wrapper or a `.admin-settings__section` class). Match it for the new AppearanceCard.

- [ ] **Step 2: Add AppearanceCard component (top-level, below imports)**

Insert above the `AdminSettings` default export:

```tsx
function AppearanceCard() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      return localStorage.getItem('hbsc-theme') === 'light' ? 'light' : 'dark'
    } catch {
      return 'dark'
    }
  })

  const handleChange = (next: 'dark' | 'light') => {
    if (next === theme) return
    setTheme(next)
    try { localStorage.setItem('hbsc-theme', next) } catch { /* noop */ }
    document.documentElement.dataset.theme = next === 'light' ? 'light' : ''
  }

  return (
    <section className="admin-settings__section">
      <header className="admin-settings__section-header">
        <h3>外观</h3>
        <p>选择后台界面的色彩风格</p>
      </header>
      <div className="admin-settings__appearance">
        <label className={`admin-settings__theme-option${theme === 'dark' ? ' is-selected' : ''}`}>
          <input
            type="radio"
            name="theme"
            value="dark"
            checked={theme === 'dark'}
            onChange={() => handleChange('dark')}
          />
          <span className="admin-settings__theme-option-title">深色</span>
          <span className="admin-settings__theme-option-desc">
            深墨底 + 暖白字 · 默认 · 长时间编辑更护眼
          </span>
        </label>
        <label className={`admin-settings__theme-option${theme === 'light' ? ' is-selected' : ''}`}>
          <input
            type="radio"
            name="theme"
            value="light"
            checked={theme === 'light'}
            onChange={() => handleChange('light')}
          />
          <span className="admin-settings__theme-option-title">浅色</span>
          <span className="admin-settings__theme-option-desc">
            暖白底 + 深墨字 · 与公开站视觉一致
          </span>
        </label>
      </div>
      <p className="admin-settings__section-footer">
        选择保存在浏览器本地，可在任何时候切换
      </p>
    </section>
  )
}
```

Make sure `useState` is imported (it likely already is).

- [ ] **Step 3: Render the AppearanceCard in AdminSettings**

Inside the AdminSettings JSX, place `<AppearanceCard />` in a logical location (near other top-level sections). Wrap it with `<div className="admin-settings__group">…</div>` if other cards use that pattern — match the existing layout.

- [ ] **Step 4: Add styles in AdminSettings.css**

Append at the bottom of `frontend-vite/src/pages/admin/AdminSettings.css`:

```css
.admin-settings__appearance {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin-top: var(--space-3);
}

.admin-settings__theme-option {
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-rows: auto auto;
  column-gap: var(--space-3);
  row-gap: 2px;
  padding: var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-2);
  background: var(--surface-1);
  cursor: pointer;
  transition: border-color 0.15s, background-color 0.15s;
}

.admin-settings__theme-option:hover {
  border-color: var(--border-strong);
}

.admin-settings__theme-option.is-selected {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.admin-settings__theme-option input[type="radio"] {
  grid-row: 1 / span 2;
  align-self: start;
  margin-top: 2px;
  accent-color: var(--accent);
}

.admin-settings__theme-option-title {
  font-weight: 500;
  color: var(--text-1);
}

.admin-settings__theme-option-desc {
  font-size: var(--type-sm);
  color: var(--text-muted);
}

.admin-settings__section-footer {
  margin-top: var(--space-3);
  font-size: var(--type-sm);
  color: var(--text-muted);
}
```

(If the existing AdminSettings uses different class-name conventions like `.admin-settings__card`, follow that convention — adjust selectors accordingly.)

- [ ] **Step 5: Run literal-scan + token contract + build**

```bash
cd frontend-vite && npm run lint:admin-tokens && npm run test:tokens && npm run build
```

Expected: all three pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang
git add frontend-vite/src/pages/admin/AdminSettings.tsx frontend-vite/src/pages/admin/AdminSettings.css
git commit -m "feat(admin): Appearance card in Settings with dark/light radio"
```

---

## Task 14: Add Playwright theme toggle + persistence spec

**Files:**
- Create: `frontend-vite/tests/admin-theme.spec.ts`

- [ ] **Step 1: Create the spec file**

Create `frontend-vite/tests/admin-theme.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

const adminPw = process.env.ADMIN_PW ?? 'admin123'
const baseURL = process.env.BASE_URL ?? 'http://localhost:5174'

async function login(page: import('@playwright/test').Page) {
  await page.goto(`${baseURL}/admin/login`)
  await page.fill('#username', 'admin')
  await page.fill('#password', adminPw)
  await page.click('button[type=submit]')
  await page.waitForURL('**/admin')
}

test.describe('Admin theme system', () => {
  test.beforeEach(async ({ context }) => {
    // Start each test from a clean localStorage so we know the default is dark.
    await context.clearCookies()
  })

  test('default theme is dark (no data-theme attribute)', async ({ page, context }) => {
    await context.addInitScript(() => { try { localStorage.clear() } catch {} })
    await login(page)
    const themeAttr = await page.evaluate(() => document.documentElement.dataset.theme)
    expect(themeAttr ?? '').toBe('')
  })

  test('light theme persists across reloads', async ({ page, context }) => {
    await context.addInitScript(() => { try { localStorage.clear() } catch {} })
    await login(page)
    // Navigate to Settings and pick light.
    await page.goto(`${baseURL}/admin/settings`)
    await page.waitForSelector('input[name="theme"][value="light"]', { timeout: 10000 })
    await page.click('input[name="theme"][value="light"]')
    // Verify attribute flipped.
    await expect.poll(async () =>
      page.evaluate(() => document.documentElement.dataset.theme)
    ).toBe('light')
    // Reload — must still be light.
    await page.reload()
    await page.waitForSelector('h1', { timeout: 10000 })
    const after = await page.evaluate(() => document.documentElement.dataset.theme)
    expect(after).toBe('light')
  })

  test('switching back to dark removes the data-theme attribute', async ({ page, context }) => {
    await context.addInitScript(() => {
      try { localStorage.setItem('hbsc-theme', 'light') } catch {}
    })
    await login(page)
    await page.goto(`${baseURL}/admin/settings`)
    await page.waitForSelector('input[name="theme"][value="dark"]', { timeout: 10000 })
    await page.click('input[name="theme"][value="dark"]')
    await expect.poll(async () =>
      page.evaluate(() => document.documentElement.dataset.theme)
    ).toBe('')
  })
})
```

- [ ] **Step 2: Run the new spec**

Run: `cd frontend-vite && npx playwright test tests/admin-theme.spec.ts`

Expected: all 3 tests pass. If a backend isn't running locally, the login step will fail — start the backend first (`cd ../backend && uvicorn app.main:app --reload --port 8000`) and the frontend dev server (`npm run dev -- --port 5174`).

- [ ] **Step 3: Commit**

```bash
cd /Users/jasonlee/hubei-shuchuang
git add frontend-vite/tests/admin-theme.spec.ts
git commit -m "test(admin): Playwright spec for theme toggle + persistence"
```

---

## Task 15: Regenerate visual snapshots for the new dark theme

**Files:**
- Modify: `frontend-vite/tests/admin-snapshots.spec.ts-snapshots/*` (auto-regenerated by Playwright)

- [ ] **Step 1: Run the existing snapshot spec with `--update-snapshots`**

Run: `cd frontend-vite && npx playwright test tests/admin-snapshots.spec.ts --update-snapshots`

Expected: 4 snapshots re-recorded (`admin-dashboard-1440.png`, `admin-articles-1440.png`, `admin-journals-1440.png`, `admin-media-1440.png`, plus `admin-dashboard-1280.png`). Diff vs. previous snapshots should reflect the new dark theme (gray-blue chrome, gold accents on active nav).

- [ ] **Step 2: Manually inspect at least one updated snapshot**

Open `frontend-vite/tests/admin-snapshots.spec.ts-snapshots/admin-dashboard-1440.png` and verify:
- Sidebar + main area are dark (`#1A1A2E`)
- Cards are slightly lighter (`#232536`)
- Text is cream (`#FAFAF7`)
- Gold logo mark + active nav border-left

- [ ] **Step 3: Commit the regenerated snapshots**

```bash
cd /Users/jasonlee/hubei-shuchuang
git add frontend-vite/tests/admin-snapshots.spec.ts-snapshots/
git commit -m "test(admin): regenerate visual snapshots for dark default theme"
```

---

## Task 16: Final verification + public-site zero-regression check

**Files:** none (verification task)

- [ ] **Step 1: Run all tests + lint**

Run:
```bash
cd frontend-vite && \
  npm run lint && \
  npm run test:tokens && \
  npm run lint:admin-tokens && \
  npm run build
```

Expected: all pass with no errors.

- [ ] **Step 2: Run all Playwright specs**

Run: `cd frontend-vite && npx playwright test`

Expected: all existing specs + new `admin-theme.spec.ts` pass.

- [ ] **Step 3: Public-site zero-regression manual check**

Start dev servers if not running. Open `http://localhost:5174/` and verify in the browser:

- ✅ Home page hero gradient: `linear-gradient(#1A1A2E → #16213E)` unchanged
- ✅ Article list / detail prose typography unchanged
- ✅ Navigation transparent → white on scroll unchanged
- ✅ Footer link colors unchanged
- ✅ Toggle the admin theme in another tab → public site unaffected (no `<html data-theme>` set there)

- [ ] **Step 4: FOUC + persistence manual check**

In admin:
1. Hard reload (⌘⇧R) on `/admin` → first frame is dark (no flash)
2. Settings → switch to light → entire UI switches instantly
3. Hard reload → first frame is light
4. Close tab, reopen `/admin` → still light
5. DevTools → Application → Local Storage → delete `hbsc-theme` → reload → back to dark

- [ ] **Step 5: Push branch + open PR**

```bash
cd /Users/jasonlee/hubei-shuchuang
git push origin HEAD
gh pr create \
  --title "feat(frontend): admin theme system — dark default + light toggle" \
  --body "Implements docs/superpowers/specs/2026-07-05-admin-theme-design.md.

- 3-tier token system in admin-tokens.css (brand atoms + semantic roles + status)
- Dark default, light opt-in via :root[data-theme=\"light\"]
- FOUC-prevention inline script in main.tsx
- Appearance card in /admin/settings
- All 11 hex + 7 rgba literals replaced with tokens
- Playwright coverage: theme toggle + persistence + visual snapshot regeneration
- 0 backend changes, 0 public-site changes

Tests:
- npm run test:tokens ✅
- npm run lint:admin-tokens ✅
- npx playwright test ✅"
```

- [ ] **Step 6: Final summary commit (no code changes)**

If anything needed cleanup during verification, commit it. Otherwise report done.

---

## Self-Review Notes

- **Spec coverage:** G1 (dark default) → Tasks 3, 11, 12, 13. G2 (light toggle) → Tasks 4, 13. G3 (no FOUC) → Tasks 11, 12. G4 (localStorage) → Tasks 12, 13, 14. G5 (public zero-regression) → Task 16. G6 (no literals) → Tasks 5-10 + Task 16. L1 scan → Tasks 2 + 16. L2 visual → Tasks 14 + 15. L3 FOUC → Task 16. L4 public → Task 16.
- **Placeholder scan:** no TBD/TODO/fill-in patterns; every code block is complete.
- **Type consistency:** `localStorage.getItem('hbsc-theme')` / `dataset.theme = 'light' | ''` used identically across Tasks 11, 12, 13, 14. Token names (`--surface-base`, `--accent`, etc.) match between admin-tokens.css (Task 3), AdminSettings.css (Task 13), and tests (Tasks 1, 4).