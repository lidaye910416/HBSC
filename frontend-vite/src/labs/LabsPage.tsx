// frontend-vite/src/labs/LabsPage.tsx
import registry from './registry.json'
import type { LabRegistry } from './types'
import { LabCard } from './LabCard'
import './labs.css'

const typedRegistry = registry as LabRegistry

export function LabsPage() {
  return (
    <div className="labs-page">
      <header className="labs-hero">
        <div className="container">
          <div className="section-label">DIGITAL INNOVATION LAB</div>
          <h1>数创实验室</h1>
          <p className="lead">
            探索 AI 驱动的内部实验项目。把一句话、一篇文章变成可交付的内容，
            让 AI 从概念走向真实的生产力。
          </p>
        </div>
      </header>

      <section className="labs-section">
        <div className="container">
          <div className="labs-section-header">
            <div className="section-label">CURRENT PROJECTS</div>
            <h2 className="labs-section-title">已上线实验</h2>
            <p className="labs-section-subtitle">
              实验室收录的、由内部团队用 vibe coding 方式构建的 AI 产品原型。
            </p>
          </div>

          <div className="lab-grid">
            {typedRegistry.labs.map((lab) => (
              <LabCard key={lab.id} lab={lab} />
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}