import type { QueryClient } from '@tanstack/react-query'

/**
 * Invalidate all public-side journal/issue caches.
 * Consumed by: Home, Navigation, Issues, IssueDetail.
 *
 * Uses prefix-matching: `['issue']` invalidates every `['issue', slug]`.
 */
export function invalidatePublicJournals(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['issues'] })
  qc.invalidateQueries({ queryKey: ['issue'] })
}

/**
 * Invalidate all public-side article caches, plus issue caches that may
 * reference this article (article_count + articles[]).
 *
 * Consumed by: Home, Articles, ArticleDetail, IssueDetail.
 *
 * Uses prefix-matching: `['articles']` invalidates every `['articles', cat, page]`,
 * `['article']` invalidates every `['article', slug]`,
 * `['issue']` invalidates every `['issue', slug]`.
 */
export function invalidatePublicArticles(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['articles'] })
  qc.invalidateQueries({ queryKey: ['article'] })
  qc.invalidateQueries({ queryKey: ['featured'] })
  qc.invalidateQueries({ queryKey: ['issue'] })
  qc.invalidateQueries({ queryKey: ['issues'] })
  qc.invalidateQueries({ queryKey: ['search'] })
}
