import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { api } from '../../services/api'

/**
 * 判断当前路由是否处于某一期期刊的文章详情页（journal_id != null）。
 * 同步检测阶段拿不到 journal_id，初值是 false；命中 /articles/:slug 时
 * 拉一次文章详情以校正。非文章详情页保持 false。该 hook 在 FAB 和
 * panel 之间共享，避免重复请求。
 */
export function useIsJournalArticle(): boolean {
  const location = useLocation()
  const slugMatch = location.pathname.match(/^\/articles\/([^/]+)\/?$/)
  const slug = slugMatch ? slugMatch[1] : null
  const [isJournalArticle, setIsJournalArticle] = useState(false)

  useEffect(() => {
    if (!slug) {
      setIsJournalArticle(false)
      return
    }
    let cancelled = false
    api.articles
      .detail(slug)
      .then((article) => {
        if (!cancelled) setIsJournalArticle(Boolean(article.journal_id))
      })
      .catch(() => {
        if (!cancelled) setIsJournalArticle(false)
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  return isJournalArticle
}
