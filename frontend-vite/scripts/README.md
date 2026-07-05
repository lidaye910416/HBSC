# frontend-vite/scripts

Local helper scripts for the frontend.

- `scan-admin-literals.sh` — fails if any hex/rgb/hsl literal lives in admin pages or components (excludes token declarations).
- `test-admin-tokens.sh` — asserts `admin-tokens.css` defines both dark (`:root`) and light (`:root[data-theme="light"]`) blocks with all expected token names.

Run via `npm run lint:admin-tokens` and `npm run test:tokens` from `frontend-vite/`.
