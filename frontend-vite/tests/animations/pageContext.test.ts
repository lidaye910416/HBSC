import { describe, expect, it } from 'vitest'
import { buildPageContextMessage, collectPageContext } from '../../src/components/ai/pageContext'

describe('pageContext', () => {
  it('extracts technical article context and adds the mind-map instruction', () => {
    document.title = '智能体系统架构解析 | 湖北数创'
    document.body.innerHTML = `
      <main>
        <article class="article-detail__main">
          <h1>智能体系统架构解析</h1>
          <div class="article-detail__content">
            <h2>多智能体协作机制</h2>
            <p>本文分析规划器、执行器、工具调用与长期记忆之间的数据流。</p>
          </div>
        </article>
      </main>
    `
    const location = new URL('https://hbsc.example/articles/agent-architecture') as unknown as Location

    const context = collectPageContext(document, location)
    const message = buildPageContextMessage(context)

    expect(context.type).toBe('technical-article')
    expect(context.title).toBe('智能体系统架构解析')
    expect(context.content).toContain('规划器、执行器、工具调用与长期记忆')
    expect(message).toContain('当前页面类型：技术文章')
    expect(message).toContain('主动提示可绘制思维导图')
  })

  it('does not label a normal content page as a technical article', () => {
    document.title = '关于我们 | 湖北数创'
    document.body.innerHTML = '<main><h1>关于我们</h1><p>记录数字变革，传播前沿理念。</p></main>'
    const location = new URL('https://hbsc.example/about') as unknown as Location

    const context = collectPageContext(document, location)

    expect(context.type).toBe('page')
    expect(context.isTechnicalArticle).toBe(false)
  })

  it('classifies an issue detail page as a content listing', () => {
    document.title = '2026 年第二期 | 湖北数创'
    document.body.innerHTML = '<main><h1>2026 年第二期</h1><section>本期文章目录</section></main>'
    const location = new URL('https://hbsc.example/issues/2026-q2') as unknown as Location

    const context = collectPageContext(document, location)

    expect(context.type).toBe('listing')
    expect(context.typeLabel).toBe('内容列表')
  })
})
