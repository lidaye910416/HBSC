import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Search, FileText, ArrowRight } from 'lucide-react'
import { api, type SearchResponse } from '../services/api'
import { batchReveal } from '../animations/batchReveal'
import './Search.css'

export function SearchPage() {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const resultsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 300)
    return () => clearTimeout(id)
  }, [query])

  const { data, isLoading } = useQuery<SearchResponse>({
    queryKey: ['search', debouncedQuery],
    queryFn: () => api.search(debouncedQuery),
    enabled: debouncedQuery.length >= 2,
  })

  // P1-01: Reveal result items as their row scrolls into the viewport.
  // batchReveal returns a cleanup that kills the underlying ScrollTriggers;
  // re-runs whenever the result set changes so newly fetched rows animate in.
  useEffect(() => {
    const root = resultsRef.current
    if (!root || isLoading || !data || data.total === 0) return
    const cleanup = batchReveal({
      root,
      selector: '[data-reveal-card]',
      y: 24,
      stagger: 0.06,
    })
    return cleanup
  }, [isLoading, data])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
  }

  return (
    <main className="search-page">
      <div className="search-hero">
        <div className="container">
          <p className="section-label">SEARCH</p>
          <h1>搜索</h1>
          <form className="search-form" onSubmit={handleSubmit}>
            <div className="search-input-wrap">
              <Search size={20} strokeWidth={1.5} className="search-icon" />
              <input
                type="text"
                className="search-input"
                placeholder="搜索研究文章、前沿资讯..."
                value={query}
                onChange={e => setQuery(e.target.value)}
                autoFocus
              />
            </div>
          </form>
          {query.length > 0 && query.length < 2 && (
            <p className="search-hint">请输入至少2个字符</p>
          )}
        </div>
      </div>

      <div className="section">
        <div className="container">
          {isLoading ? (
            <div className="search-loading">
              <div className="skeleton-result" />
              <div className="skeleton-result" />
              <div className="skeleton-result" />
            </div>
          ) : data && debouncedQuery.length >= 2 ? (
            <div className="search-results" ref={resultsRef}>
              <p className="search-results__count">
                找到 <strong>{data.total}</strong> 个结果
              </p>

              {data.items.length > 0 && (
                <div className="search-section">
                  <h3 className="search-section__title">
                    <FileText size={16} strokeWidth={1.5} /> 研究文章
                  </h3>
                  <div className="search-results-list">
                    {data.items.map((item) => (
                      <Link key={item.id} to={`/articles/${item.slug}`} className="search-result-item" data-reveal-card>
                        <div className="search-result-item__icon">
                          <FileText size={18} strokeWidth={1.5} />
                        </div>
                        <div className="search-result-item__text">
                          <h4>{item.title}</h4>
                          <span className="search-result-item__type">{item.category || '研究文章'}</span>
                        </div>
                        <ArrowRight size={14} className="search-result-item__arrow" strokeWidth={1.5} />
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {data.total === 0 && (
                <div className="articles-empty">
                  <Search size={48} strokeWidth={1} />
                  <h3>未找到相关结果</h3>
                  <p>请尝试其他关键词</p>
                </div>
              )}
            </div>
          ) : query.length === 0 ? (
            <div className="search-empty">
              <Search size={48} strokeWidth={1} />
              <h3>开始搜索</h3>
              <p>输入关键词，搜索研究文章和前沿资讯</p>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  )
}
