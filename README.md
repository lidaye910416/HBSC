# 寄思科技有限责任公司 (Jisi Technology Co., Ltd.)

> 聚焦前沿科技与复杂系统研发的科技公司

![Node](https://img.shields.io/badge/Node.js-18+-green) ![Python](https://img.shields.io/badge/Python-3.10+-blue) ![License](https://img.shields.io/badge/License-MIT-orange)

## 技术栈

- **前端**: React 18 + TypeScript + Vite + React Router v6 + TanStack Query
- **后端**: FastAPI + SQLAlchemy + SQLite
- **设计**: 科技简约美学 — 墨色+金色配色体系

## 快速启动

### 前置要求
- Node.js 18+
- Python 3.10+
- npm 或 yarn

### 1. 启动后端

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

后端运行于: http://localhost:8000  
API 文档: http://localhost:8000/docs

### 2. 启动前端

```bash
cd frontend-vite
npm install
npm run dev
```

前端运行于: http://localhost:5173

### 3. 访问网站

打开浏览器访问 http://localhost:5173

首次启动时，数据库会自动初始化并填充示例数据（9篇文章、8条资讯、3个案例、6位研究人员、6个研究领域）。

## 项目结构

```
jisi-tech/
├── SPEC.md                    # 项目规范文档
├── README.md                  # 本文件
│
├── backend/                   # FastAPI 后端
│   ├── requirements.txt
│   └── app/
│       ├── main.py            # FastAPI 入口
│       ├── config.py          # 配置
│       ├── database.py        # 数据库连接
│       ├── models/            # SQLAlchemy 模型
│       ├── schemas/           # Pydantic 模型
│       ├── routers/           # API 路由
│       └── services/          # 业务逻辑 + 种子数据
│
└── frontend-vite/             # React 前端
    ├── package.json
    ├── vite.config.ts
    └── src/
        ├── App.tsx            # 主应用
        ├── services/api.ts     # API 调用层
        ├── components/         # 通用组件
        ├── pages/              # 页面组件
        └── styles/             # 全局样式
```

## 主要页面

| 页面 | 路由 | 说明 |
|------|------|------|
| 首页 | `/` | Hero + 研究领域 + 精选文章 + 资讯流 + 团队 |
| 研究文章 | `/articles` | 分类筛选 + 卡片网格 + 分页 |
| 文章详情 | `/articles/:slug` | Markdown 正文 + 作者信息 + 相关推荐 |
| 前沿资讯 | `/insights` | 资讯流 + 分类筛选 + 展开详情 |
| 研究案例 | `/cases` | 案例卡片 + 详情页 |
| 关于我们 | `/about` | 使命 + 发展历程 + 团队 + 合作机构 |
| 搜索 | `/search` | 实时搜索文章和资讯 |

## API 端点

```
GET  /api/articles              # 文章列表 (支持 category/page/per_page)
GET  /api/articles/featured    # 精选文章
GET  /api/articles/:slug       # 文章详情
GET  /api/insights             # 资讯列表
GET  /api/cases                # 案例列表
GET  /api/domains              # 研究领域
GET  /api/team                 # 研究团队
GET  /api/search?q=            # 搜索
POST /api/newsletter           # 订阅
```

## 设计特点

- **新东方科研美学**: 深邃墨色 (#1A1A2E) + 温暖米白 (#F5F0E8) + 古铜金 (#C9A84C)
- **字体**: Noto Serif SC (标题) + Noto Sans SC (正文) + Cormorant Garamond (英文)
- **动画**: 墨迹流动背景、入场渐显、卡片悬停上浮、滚动触发动画
- **响应式**: Desktop (>=1024px) / Tablet (768-1023px) / Mobile (<768px)

## 部署建议 (中国大陆)

- **前端**: 阿里云 OSS + CDN（需 ICP 备案）或 Vercel（国内访问可能较慢）
- **后端**: 阿里云 ECS / Docker 容器
- **数据库**: 阿里云 RDS PostgreSQL（生产环境）
- **图床/静态文件**: 阿里云 OSS

## License

MIT
