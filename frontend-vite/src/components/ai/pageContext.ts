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
  // The contract: structure requests (导图 / 梳理结构 / 总结要点) MUST be
  // answered with a `markmap` fenced code block containing markdown
  // headings. The MindmapBlock component renders this into a radial
  // SVG via markmap-view. We teach the model this contract in
  // `mindMapInstruction` below.
  // Keep the legacy phrase "主动提示可绘制思维导图" so the existing test
  // in tests/animations/pageContext.test.ts stays green without churn.
  // Mindmap contract: ask the model for a markdown heading tree inside a
  // `markmap` fenced block. markmap (the renderer) parses markdown headings
  // (`#` / `##` / `###`) into a radial mind map. Compared to mermaid's
  // mindmap syntax, this is more natural for LLMs (they already speak
  // markdown headings) and produces a denser, more readable default render.
  const mindMapSyntax = [
    '思维导图必须以 ```markmap 围栏代码块输出（不要用 mermaid / flowchart）；',
    '内部使用 Markdown 标题层级：',
    '  - 第 1 行 `# 主题` 是根节点（必须有且只有 1 个 # 标题）；',
    '  - 第 2 行 `## 分支` 是一级分支，至少 4 个；',
    '  - 第 3 行 `### 叶子` 是子节点，每个一级分支下至少 2 个；',
    '  - 不使用 #### 或更深层级；',
    '  - 标题文字 ≤ 10 个汉字 / 5 个英文单词。',
  ].join('\n')

  const mindMapInstruction = context.isTechnicalArticle
    ? [
        '这是技术文章；遇到复杂概念或结构性问题时，主动提示可绘制思维导图帮助用户理解内容。',
        '当用户要求「画思维导图 / 整理结构 / 梳理要点」时，必须输出一个 ```markmap 围栏代码块。',
        mindMapSyntax,
        '示例：',
        '```markmap',
        '# AI 与内容产业',
        '## 技术栈',
        '### 大模型',
        '### 智能体',
        '### 检索增强',
        '## 应用场景',
        '### 内容生成',
        '### 内容审核',
        '### 个性化推荐',
        '## 商业模式',
        '### SaaS 订阅',
        '### 按量计费',
        '## 挑战',
        '### 版权风险',
        '### 算力成本',
        '```',
        '其他回答可正常输出 Markdown。',
      ].join('\n')
    : [
        '如果页面内容具有明显层级或复杂关系，可询问用户是否需要结构化梳理。',
        '当用户要求「画思维导图 / 梳理结构 / 总结要点」时，必须输出一个 ```markmap 围栏代码块。',
        mindMapSyntax,
      ].join('\n')

  return [
    '你是湖北数创网站的“数创智伴”。用户询问“本页、这篇文章、这里”等内容时，必须优先依据以下页面上下文精准回答；不要假装看不到页面，也不要编造页面未提供的信息。',
    '回答默认使用 Markdown 格式（标题、列表、表格、代码块都可使用）。',
    `当前页面类型：${context.typeLabel}`,
    `当前页面标题：${context.title}`,
    `当前页面 URL：${context.url}`,
    mindMapInstruction,
    '当前页面正文：',
    context.content || '页面暂无可提取的正文，请明确告知用户。',
  ].join('\n')
}
