# 湖北数创 — 项目规范文档

## 1. Concept & Vision

**湖北数创**是湖北数字产业创新研究的内部期刊展示平台，聚焦数字产业政策解读、技术趋势分析、数字化转型案例。设计风格采用政务蓝+科技感的专业风格，体现权威性与前瞻性。

---

## 2. Design Language

### 2.1 Aesthetic Direction
**政务科技美学** — 参考政府官方网站的专业感 + 现代科技期刊的视觉呈现，融合蓝色主调与几何图形设计，传递权威、前沿、创新的品牌形象。

### 2.2 Color Palette
```
Primary (政务蓝):      #1E40AF  — 深邃政务蓝，沉稳底色
Secondary (科技灰):    #64748B  — 科技灰，辅助色调
Accent (创新橙):      #F97316  — 创新橙，强调与活力
Accent-light:         #FED7AA  — 浅橙，用于hover态
Text Primary:         #1E293B  — 正文深色
Text Secondary:       #64748B  — 辅助灰
Text Muted:           #94A3B8  — 时间戳/标签灰
Background:           #F8FAFC  — 浅灰白底
Surface:              #FFFFFF  — 卡片纯白
Border:               #E2E8F0  — 淡灰分隔线
Dark Surface:         #1E3A8A  — 深蓝区块背景
Dark Border:          #1E40AF  — 深蓝区块边框
Success:              #059669  — 成功绿
Highlight:            #7C3AED  — 紫色高亮
```

### 2.3 Typography
- **中文标题**: "Noto Serif SC" (Google Fonts), weight 700
- **中文正文**: "Noto Sans SC", weight 400/500
- **英文/UI**: "Inter", weight 400/500/600
- **Fallback**: serif / sans-serif

**字号系统**:
- Hero标题: 56px / line-height 1.1
- H1: 40px / 1.2
- H2: 32px / 1.3
- H3: 24px / 1.4
- H4: 20px / 1.5
- Body: 16px / 1.7
- Small: 14px / 1.6
- Caption: 12px / 1.5

### 2.4 Visual Assets
- **图标库**: Lucide React (stroke-width 1.5)
- **装饰元素**: 科技感几何图案、细线几何图形分隔符
- **Logo**: 文字 Logo "湖北数创"

---

## 3. Content Structure | 内容结构

### 3.1 期刊结构
每期期刊包含以下四个部分：

1. **战略与政策** - 政策解读、规划纲要
2. **技术与产业** - 技术趋势、投研报告
3. **方案与思考** - 案例研究、转型方案
4. **动态与文化** - 团队动态、人物风采

### 3.2 当前内容

#### 2026 第一期
- **战略与政策**
  - 关于十五五规划纲要的解读
  - 数字产业2026年政策
- **技术与产业**
  - OpenClaw 开源代理框架核心设计
  - 国际技术投研报告精选
- **方案与思考**
  - 中小企业数字化转型路径分析与案例研究
  - 嘉鱼县基层综合服务信息平台建设实践
  - 大型国有企业ESB架构设计与实施路径-湖北联投集团案例研究
- **动态与文化**
  - 数产一季度新闻汇总
  - 湖北数创青年先锋人物

---

## 4. Technical Approach

### 4.1 前端 (React + Vite)
```
frontend-vite/
├── src/
│   ├── components/
│   ├── pages/
│   ├── hooks/
│   ├── services/
│   ├── styles/
│   └── App.tsx
```

**核心依赖**: React 18 + TypeScript, Vite, React Router v6, @tanstack/react-query, Lucide React

### 4.2 后端 (FastAPI + Python)
```
backend/
├── app/
│   ├── main.py
│   ├── config.py
│   ├── database.py
│   ├── models/
│   ├── schemas/
│   ├── routers/
│   └── services/
```

**核心依赖**: FastAPI, SQLAlchemy + SQLite, Pydantic, Uvicorn
