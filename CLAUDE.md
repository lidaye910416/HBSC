# 湖北数创 (Hubei Digital Innovation) — 项目规范

## 项目概述

**寄思科技有限责任公司**是一个聚焦前沿科技与复杂系统研发的科技公司。技术栈：React + Vite（前端）+ FastAPI + SQLAlchemy（后端）。

## 目录结构

```
jisi-tech/
├── SPEC.md                    # 完整设计规范文档
├── CLAUDE.md                  # 本文件
├── CSS_LAYOUT_GOTCHAS.md      # CSS 布局常见陷阱（详细）
├── README.md                  # 项目说明
├── docker-compose.yml         # Docker 部署配置
│
├── backend/                   # FastAPI 后端
│   ├── app/main.py            # 入口 + 种子数据初始化
│   ├── app/models/            # SQLAlchemy 模型
│   ├── app/routers/           # API 路由
│   └── requirements.txt
│
└── frontend-vite/            # React + Vite 前端
    ├── src/
    │   ├── App.tsx           # 主应用（Layout 组件在此）
    │   ├── main.tsx          # 入口（注意：导入 index.css）
    │   ├── index.css         # ⚠️ 只写极简内容，禁止写 width 约束
    │   ├── App.css           # ⚠️ 只写极简内容，禁止写 width 约束
    │   ├── styles/global.css # 主样式文件（所有布局规则在此）
    │   ├── components/        # 通用组件
    │   ├── pages/            # 页面组件
    │   └── services/api.ts    # API 调用层
    └── Dockerfile
```

## 启动命令

```bash
# 后端
cd backend && uvicorn app.main:app --reload --port 8000

# 前端
cd frontend-vite && npm install && npm run dev -- --port 5173
```

## 技术要点

### CSS 布局（必读）

**不要修改以下文件的布局相关属性：**
- `frontend-vite/src/index.css` — 脚手架默认残留，已清空，**禁止添加 width 约束**
- `frontend-vite/src/App.css` — 同上

**所有布局规则写在：** `frontend-vite/src/styles/global.css`

**全屏背景方案：** 使用 `App.tsx` 中的 `.app-bg` div + CSS `position: fixed; inset: 0; z-index: -1`

**详情见：** `CSS_LAYOUT_GOTCHAS.md`

### API

| 端点 | 说明 |
|------|------|
| `GET /api/articles` | 文章列表（支持 category/page/per_page） |
| `GET /api/articles/:slug` | 文章详情 |
| `GET /api/articles/featured` | 精选文章 |
| `GET /api/insights` | 前沿资讯 |
| `GET /api/cases` | 研究案例 |
| `GET /api/domains` | 研究领域 |
| `GET /api/team` | 研究团队 |
| `GET /api/search?q=` | 搜索 |
| `POST /api/newsletter` | 订阅 |

API 地址：`http://localhost:8000`  
前端代理：`http://localhost:5173`

### 数据

首次启动后端时，数据自动初始化并填充（9篇文章、8条资讯、3个案例、6位研究人员、6个研究领域）。

### 组件列表

| 组件 | 说明 |
|------|------|
| `Navigation` | 固定导航栏（透明→滚动后白底磨砂） |
| `ArticleCard` | 文章卡片（封面+摘要+作者+阅读时间） |
| `DomainCard` | 研究领域卡片（深色+金色边框hover） |
| `Footer` | 页脚 |
| `NewsletterForm` | 订阅表单 |

### 页面列表

| 路由 | 组件 |
|------|------|
| `/` | Home.tsx |
| `/articles` | Articles.tsx |
| `/articles/:slug` | ArticleDetail.tsx |
| `/insights` | Insights.tsx |
| `/cases` | Cases.tsx |
| `/about` | About.tsx |
| `/search` | Search.tsx |

## 设计系统

- **主色**：墨 `#1A1A2E`、深墨 `#16213E`
- **强调色**：古铜金 `#C9A84C`
- **背景**：暖白 `#FAFAF7`、米白 `#F5F0E8`
- **字体**：
  - Noto Serif SC — 中文标题与正文（衬线，深阅读）
  - Noto Sans SC — 中文 UI / 卡片 / 摘要
  - Inter — 拉丁 UI 与英文正文
  - Cormorant Garamond — 拉丁装饰字体（仅 Latin 字符通过 unicode-range 生效）:
    - 英文 H1/H2 自动 fallback，中文保持 Noto Serif SC
    - .prose-lg 首字下沉（首字母）
    - .prose blockquote 大引号装饰

### Typography 类族 (global.css)
- .prose — 基础长文（1.0625rem, line-height 1.9, max-width 720px）
- .prose-lg — 详情页主文（1.125rem, line-height 1.95, 首字下沉）
- .prose-sm — 卡片摘要 / 侧栏简介（0.9375rem, line-height 1.7）

### 通用组件
- Breadcrumb items=[{label,to?}] variant=dark|light — 4 处详情页共用，自动去重相邻重复 label

### 表格
- 详情页表格用 .prose table，斑马纹 + hover 高亮 + 移动端横向滚动
- 移动端用 div.prose-table-wrap 包裹

## 部署

- 前端构建：`cd frontend-vite && npm run build`（输出到 `dist/`）
- Docker：`docker-compose up --build`
