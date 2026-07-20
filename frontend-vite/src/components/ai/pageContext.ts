export type PageContext = {
  type: 'technical-article' | 'article' | 'listing' | 'page'
  typeLabel: string
  title: string
  url: string
  content: string
  isTechnicalArticle: boolean
}

const MAX_CONTENT_LENGTH = 12_000
const TECHNICAL_TERMS = /(?:架构|算法|模型|智能体|AI|人工智能|数据|系统|平台|接口|API|代码|开发|技术|工程|网络|云计算|数据库|区块链|大模型|数字化)/i

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function pageTitle(doc: Document): string {
  const heading = doc.querySelector<HTMLElement>(
    '[data-detail-title], .article-detail__title, article h1, main h1',
  )
  const title = normalizeText(heading?.innerText ?? '')
  if (title) return title
  return normalizeText(doc.title.replace(/\s*[|｜-]\s*湖北数创.*$/i, '')) || '当前页面'
}

function pageContent(doc: Document): string {
  const source = doc.querySelector<HTMLElement>(
    '.article-detail__content, article, main, [role="main"]',
  )
  if (!source) return ''
  const clone = source.cloneNode(true) as HTMLElement
  clone.querySelectorAll(
    'nav, footer, aside, script, style, noscript, [data-testid^="page-agent"], .article-detail__share, .article-detail__related',
  ).forEach((node) => node.remove())
  return normalizeText(clone.innerText || clone.textContent || '').slice(0, MAX_CONTENT_LENGTH)
}

export function collectPageContext(doc: Document, location: Location): PageContext {
  const title = pageTitle(doc)
  const content = pageContent(doc)
  const isArticle = location.pathname.startsWith('/articles/') || Boolean(doc.querySelector('article'))
  const isTechnicalArticle = isArticle && TECHNICAL_TERMS.test(`${title} ${content.slice(0, 4_000)}`)
  const type: PageContext['type'] = isTechnicalArticle
    ? 'technical-article'
    : isArticle
      ? 'article'
      : /^\/(?:articles|issues|search)(?:\/|$)/.test(location.pathname)
        ? 'listing'
        : 'page'

  return {
    type,
    typeLabel: type === 'technical-article'
      ? '技术文章'
      : type === 'article'
        ? '文章'
        : type === 'listing'
          ? '内容列表'
          : '页面',
    title,
    url: location.href,
    content,
    isTechnicalArticle,
  }
}

export function buildPageContextMessage(context: PageContext): string {
  const mindMapInstruction = context.isTechnicalArticle
    ? '这是技术文章；回答复杂概念或结构性问题后，主动提示可绘制思维导图帮助用户理解内容。'
    : '如果页面内容具有明显层级或复杂关系，可询问用户是否需要结构化梳理。'

  return [
    '你是湖北数创网站的“数创智伴”。用户询问“本页、这篇文章、这里”等内容时，必须优先依据以下页面上下文精准回答；不要假装看不到页面，也不要编造页面未提供的信息。',
    `当前页面类型：${context.typeLabel}`,
    `当前页面标题：${context.title}`,
    `当前页面 URL：${context.url}`,
    mindMapInstruction,
    '当前页面正文：',
    context.content || '页面暂无可提取的正文，请明确告知用户。',
  ].join('\n')
}
