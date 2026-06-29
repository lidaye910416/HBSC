/**
 * PageAgentMount is now a thin re-export of the runtime panel.
 *
 * Historical context (kept for reviewers):
 *   - Earlier revisions of this file instantiated the page-agent v1.10
 *     IIFE bundle from jsDelivr (`page-agent.demo.js`) and disabled its
 *     LLM via `model: '__disabled__'`. That bundle cannot consume our
 *     flat `{ content: string }` server proxy, so the widget was a
 *     dead-weight mount that fetched a 1.4 MB script for nothing.
 *   - Phase C: we replaced it with PageAgentPanel — a thin in-house chat
 *     UI that calls the same backend endpoint.
 */
export { PageAgentPanel as PageAgentMount } from './PageAgentPanel'
