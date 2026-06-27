import { Link } from 'react-router-dom'
import { Clock, Eye } from 'lucide-react'
import type { ArticleList } from '../services/api'
import { Badge } from './ui/badge'
import { CoverImage } from './CoverImage'
import './ArticleCard.css'

interface Props {
  article: ArticleList
  featured?: boolean
}

export function ArticleCard({ article }: Props) {
  const date = article.published_at
    ? new Date(article.published_at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
    : ''

  return (
    <Link to={`/articles/${article.slug}`} className="article-card group">
      <CoverImage
        src={article.cover_image}
        alt={article.title}
        category={article.category}
        aspectRatio="16 / 9"
        className="article-card__image"
      />
      <div className="article-card__body">
        {article.category && (
          <Badge variant="secondary" className="article-card__category">{article.category}</Badge>
        )}
        <h3 className="article-card__title">{article.title}</h3>
        {article.summary && <p className="article-card__summary">{article.summary}</p>}
        <div className="article-card__footer">
          <div className="article-card__meta">
            {article.author_avatar && (
              <img src={article.author_avatar} alt={article.author_name} className="article-card__avatar" />
            )}
            <div>
              {article.author_name && <span className="article-card__author">{article.author_name}</span>}
              {date && <span className="article-card__date">{date}</span>}
            </div>
          </div>
          <div className="article-card__stats">
            <span><Clock size={12} /> {article.reading_time}分钟</span>
            <span><Eye size={12} /> {article.views}</span>
          </div>
        </div>
      </div>
    </Link>
  )
}
