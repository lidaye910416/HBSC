import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search, BookOpen } from 'lucide-react'
import { api } from '../services/api'
import { ArticleCard } from '../components/ArticleCard'
import { Breadcrumb } from '../components/Breadcrumb'
import './Articles.css'

const categories = ['全部', '战略与政策', '技术与产业', '方案与思考', '动态与文化']

export function Articles() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeCategory = searchParams.get('category') || ''
  const page = parseInt(searchParams.get('page') || '1')

  const { data, isLoading } = useQuery({
    queryKey: ['articles', activeCategory, page],
    queryFn: () => api.articles.list({ category: activeCategory || undefined, page, per_page: 9 }),
  })

  const setCategory = (cat: string) => {
    setSearchParams(cat && cat !== '全部' ? { category: cat } : {})
  }

  const activeLabel = activeCategory || '全部'

  return (
    <main className="articles-page">
      {/* Hero */}
      <section className="articles-hero">
        <div className="articles-hero__bg" aria-hidden="true">
          <div className="articles-hero__orb articles-hero__orb--1" />
          <div className="articles-hero__orb articles-hero__orb--2" />
          <div className="articles-hero__grid" />
        </div>
        <div className="container articles-hero__inner">
          <Breadcrumb
            variant="dark"
            items={[
              { label: '首页', to: '/' },
              { label: '文章' },
            ]}
          />
          <p className="section-label articles-hero__eyebrow">
            <BookOpen size={14} strokeWidth={2} /> CONTENT · 期刊内容
          </p>
          <h1 className="articles-hero__title">湖北数创期刊</h1>
          <p className="articles-hero__desc">
            记录数字变革、传播前沿理念、赋能产业升级 ——
            汇聚战略洞察、技术解析与行业思考，构建可持续的产业知识高地
          </p>
          <div className="articles-hero__stats">
            <div className="articles-hero__stat">
              <span className="articles-hero__stat-num">{data?.total ?? '—'}</span>
              <span className="articles-hero__stat-label">收录文章</span>
            </div>
            <div className="articles-hero__stat-divider" />
            <div className="articles-hero__stat">
              <span className="articles-hero__stat-num">{categories.length - 1}</span>
              <span className="articles-hero__stat-label">内容板块</span>
            </div>
            <div className="articles-hero__stat-divider" />
            <div className="articles-hero__stat">
              <span className="articles-hero__stat-num">每周</span>
              <span className="articles-hero__stat-label">持续更新</span>
            </div>
          </div>
        </div>
      </section>

      {/* Articles section */}
      <div className="section">
        <div className="container">
          <div className="section-header">
            <p className="section-label">BROWSE</p>
            <h2 className="section-title">浏览全部文章</h2>
            <div className="divider" />
            <p className="section-subtitle">按主题筛选，发现你感兴趣的内容</p>
          </div>

          <div className="articles-toolbar">
            <div className="filter-bar" role="tablist" aria-label="文章分类">
              {categories.map(cat => (
                <button
                  key={cat}
                  role="tab"
                  aria-selected={(cat === '全部' && !activeCategory) || activeCategory === cat}
                  className={`filter-btn ${(cat === '全部' && !activeCategory) || activeCategory === cat ? 'active' : ''}`}
                  onClick={() => setCategory(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>
            {!isLoading && data && (
              <div className="articles-count" aria-live="polite">
                当前 <strong>{activeLabel}</strong> · 共 <strong>{data.total}</strong> 篇
              </div>
            )}
          </div>

          {isLoading ? (
            <div className="articles-loading">
              {[...Array(6)].map((_, i) => <div key={i} className="skeleton-card" />)}
            </div>
          ) : data?.items.length === 0 ? (
            <div className="empty-state">
              <Search size={36} strokeWidth={1.5} />
              <h3>暂无文章</h3>
              <p>该分类下暂无文章，敬请期待</p>
              <button className="btn btn-outline" onClick={() => setCategory('全部')}>
                查看全部内容
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-3 articles-grid">
                {data?.items.map(article => (
                  <ArticleCard key={article.id} article={article} />
                ))}
              </div>
              {data && data.pages > 1 && (
                <nav className="pagination" aria-label="文章分页">
                  <button
                    className="pagination__btn pagination__nav"
                    disabled={page <= 1}
                    onClick={() => setSearchParams({ ...(activeCategory ? { category: activeCategory } : {}), page: String(Math.max(1, page - 1)) })}
                    aria-label="上一页"
                  >
                    ‹
                  </button>
                  {Array.from({ length: data.pages }, (_, i) => i + 1).map(p => (
                    <button
                      key={p}
                      className={`pagination__btn ${p === page ? 'active' : ''}`}
                      onClick={() => setSearchParams({ ...(activeCategory ? { category: activeCategory } : {}), page: String(p) })}
                      aria-current={p === page ? 'page' : undefined}
                    >
                      {p}
                    </button>
                  ))}
                  <button
                    className="pagination__btn pagination__nav"
                    disabled={page >= data.pages}
                    onClick={() => setSearchParams({ ...(activeCategory ? { category: activeCategory } : {}), page: String(Math.min(data.pages, page + 1)) })}
                    aria-label="下一页"
                  >
                    ›
                  </button>
                </nav>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  )
}
