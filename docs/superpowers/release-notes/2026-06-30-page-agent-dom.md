# page-agent DOM Mode — Release Notes (2026-06-30)

## What ships

- Public homepage `page-agent` FAB now supports dual modes:
  - ✿ 问他 — text-only chat via existing `/api/public/agent/execute` (no DOM loop).
  - ✿ 让他操作 — DOM multi-step agent via new `/api/public/agent/llm` (customFetch).
- All OpenAI tool-calling requests are proxied; api_key never leaves the server.
- 10-layer safety: data-ai-blocked audit, prompt safety rails, URL-strict match,
  Referer same-origin, dom 5/min IP rate-limit, 2MB payload cap, secret masking,
  JS injection disabled, maxSteps=20, single-step 30s timeout.
- Admin-side chat endpoints removed; connectivity probe now under settings_router.

## Operator notes

- Existing `page_agent.api_key` continues to drive both modes — no new key required.
- Admin → Settings → page-agent row: new blurb hints at the dual-mode + public-only use.
- If you want to disable DOM mode for a window, temporarily point
  `page_agent.base_url` to `http://...` (anything non-https): the dom endpoint
  rejects with 409 `dom_requires_https_base_url`, so the panel's
  ✿ 让他操作 button will surface that error.

## Test coverage at this commit

- pytest: 83 backend tests passing (new: 8 dom-mode cases + 3 execute-mode cases + 3 probe-migration cases + 6 safety-rail assertions in synthesis test).
- Playwright: 6/6 page-agent spec cases passing.
- Pre-existing specs (admin-snapshots, ai-typesetter-dialog): also passing after .env hash re-sync to admin123 default.
