# HBSC 细节调优 — 设计规格

**日期:** 2026-06-29
**范围:** 前端 (Footer / ArticleDetail / About) + 后端 (admin API 调用) + 后端管理功能微调
**目标:** 修复 4 处用户可见的细节问题

---

## 一、问题陈述

1. **地址错误**: Footer 联系我们区域显示 "武汉市东湖高新区"，实际应为 "湖北省小龟山金融文化公园19栋"。
2. **Twitter 链接残留**: 前端有 3 处 Twitter 链接（Footer 社交图标、文章详情分享、About 团队成员字段），公司已不再使用 Twitter 平台。
3. **cover-image 全显蓝色**: 所有文章卡片显示蓝色渐变占位。这是 `CoverImage` 组件在 `cover_image` 为空/加载失败时的 CSS fallback。用户希望按以下策略调优：评估每篇文章正文中的内嵌图片，质量好 → 通过 admin API 写入 `cover_image`；没有或质量差 → 留空（继续显示蓝色 fallback）。
4. **admin 文章 button 跳错误页**: 在 `ArticleList` 上点击"编辑"/"管理精选"/"新建文章"等按钮后，页面跳到错误页。根因是 `ArticleList.tsx:1` 漏导入 `useState`，列表页直接崩溃。

---

## 二、范围

### 包含

- 1 行 Footer 地址修改
- 删除 3 处 Twitter 链接渲染
- 清理 `api.ts` 中 `Member.twitter` 类型字段（不删除字段以保留后端兼容性，仅前端不再渲染）
- 11 篇文章 cover-image 评估与更新
- `ArticleList.tsx:1` `useState` 导入修复
- 配套：增加 React Router `<Route path="*">` 兜底（防止未来类似 404 误判）
- 配套：所有改动后跑 `npm run tsc --noEmit` + 后端 smoke test

### 不包含

- 后端新功能（如图片质量自动评分 API）— 不需要，全部在前端评估后用 admin API 写入
- seed 数据的 11 张 jpg 文件评估 — 用户明确说"仅评估文章正文里的内嵌图片"
- Twitter 字段的数据库迁移 — 后端 model/schema 保持不变
- CoverImage 组件本身的设计调整 — 仅按现有 fallback 行为使用

---

## 三、设计

### 3.1 任务 1：地址修改

**文件:** `frontend-vite/src/components/Footer.tsx:62`

**修改前:**
```tsx
<li>武汉市东湖高新区</li>
```

**修改后:**
```tsx
<li>湖北省小龟山金融文化公园19栋</li>
```

### 3.2 任务 2：删除 Twitter 链接

**文件 A:** `frontend-vite/src/components/Footer.tsx:35-39`

- 删除 X.com 社交链接 `<a href="https://x.com/jiangshang_cn" ...>` 整段 JSX（包括外层 `<li>` 和 import 的 `X` 图标如果仅此一处使用）

**文件 B:** `frontend-vite/src/pages/ArticleDetail.tsx:177-181` + `419-423`

- 删除 `handleShareTwitter` 函数
- 删除 Twitter 分享按钮 JSX（含 import 的 `MessageCircle` 图标如果仅此一处使用）

**文件 C:** `frontend-vite/src/pages/About.tsx:119-123`

- 删除 `member.twitter && (...)` 整段 JSX
- 后端 model 仍保留 `twitter` 字段，前端类型 `Member.twitter` 仍保留（防止破坏其他数据流），仅 UI 不再渲染

**注意:** 三个文件中如需连带删除 import 的图标组件（`X`, `MessageCircle`），使用 grep 确认仅此一处使用即可删除 import。

### 3.3 任务 3：cover-image 质量评估与更新

**数据流:**
```
backend GET /api/articles  (含 content 字段) 
  → 提取 markdown 中的 ![](url) 图片
  → 评估每张图（技术指标 + 主题相关性）
  → 优选 1 张最合适的
  → 调 admin API: PUT /api/admin/articles/{id}  (body: {cover_image: url})
```

**评估标准:**

| 维度 | 阈值 |
|---|---|
| 分辨率 | width ≥ 1280 且 height ≥ 720 |
| 文件大小 | ≥ 30KB（避免占位图/缩略图） |
| 纵横比 | width / height ≥ 1.5（横版或方版） |
| 可访问 | HTTP 200，Content-Type 为 image/* |
| 主题相关性 | URL 关键词 / 上下文文案 与文章 category 匹配（AI/Policy/Research/Industry） |

**主题相关性关键词表（参考，可由子代理扩展）:**

| Category | 关键词（中英文） |
|---|---|
| 人工智能/AI | ai, agent, gpt, llm, 算法, 模型, 智能, 机器人, 神经网络 |
| 政策/Policy | 政策, 规划, 纲要, 政府, 会议, 报告, 数字经济, 五年 |
| 前沿/Research | 研究, 论文, 实验, 技术, 框架, 学术, 突破 |
| 产业/Industry | 企业, 行业, 转型, 案例, 工厂, 供应链, 中小企业 |

**执行方式:**

- 由一个子代理读取 `/api/articles` 公开 API（无需鉴权），拿到全部 11 篇文章的 `content`
- 用 Python/Node 脚本解析 markdown 提取所有图片 URL（`![](url)` 模式）
- 对每张图评分（技术分 + 主题分，加权求和）:
  - 技术分（0-5）= 分辨率（≥1280×720 给 2 分，< 1280 给 0 分）+ 文件大小（≥30KB 给 1.5 分，< 30KB 给 0 分）+ 纵横比（≥1.5 给 1.5 分）
  - 主题分（0-5）= 关键词匹配数 × 1（最多 5 分）
  - 总分 ≥ 6 分视为"质量较好"
- 对一篇文章，**取所有图中总分最高的那张**（如果 ≥ 6 分）作为新 cover_image
- 调 admin API 写入
- 写入需 `POST /api/admin/auth/login` 拿 token（ephemeral admin credentials，参考历史观测 #1980）

**后端管理功能微调:**

- 评估报告通过 admin API 写入数据库，不修改 admin UI
- 无需新增 API 端点

**失败处理:**

- 图片 URL 不可访问 → 跳过该图，继续评估其他图
- 所有图都不达标 → 不调 API（保持 cover_image 为空，显蓝）
- admin API 调用失败 → 记录错误到报告，不抛异常中断流程

### 3.4 任务 4：ArticleList 导入修复

**文件:** `frontend-vite/src/pages/admin/ArticleList.tsx:1`

**修改前:**
```tsx
import { useEffect, useRef } from 'react'
```

**修改后:**
```tsx
import { useEffect, useRef, useState } from 'react'
```

**配套优化（建议）:** `frontend-vite/src/App.tsx`

- 在路由末尾增加 `<Route path="*" element={<NotFound />} />` 兜底
- 新建 `frontend-vite/src/pages/NotFound.tsx`：简洁的 404 页面（"页面不存在" + 返回首页按钮）

---

## 四、文件清单

### 修改

| 文件 | 行号 | 任务 |
|---|---|---|
| `frontend-vite/src/components/Footer.tsx` | 35-39, 62 | 1, 2 |
| `frontend-vite/src/pages/ArticleDetail.tsx` | 177-181, 419-423 + 相关 import | 2 |
| `frontend-vite/src/pages/About.tsx` | 119-123 | 2 |
| `frontend-vite/src/pages/admin/ArticleList.tsx` | 1 | 4 |
| `frontend-vite/src/App.tsx` | 末尾 | 4（配套） |

### 新增

| 文件 | 任务 |
|---|---|
| `frontend-vite/src/pages/NotFound.tsx` | 4（配套） |

### 不修改

- 后端 `backend/app/` 任何文件（admin API 已具备所需端点）
- `frontend-vite/src/services/api.ts`（`Member.twitter` 字段保留以兼容后端 schema）

---

## 五、验收标准

1. **地址**: Footer 显示"湖北省小龟山金融文化公园19栋"
2. **Twitter 链接**: 全站无 Twitter/X.com 链接（包括 footer、article detail、about 页面）
3. **cover-image**:
   - 11 篇文章逐篇评估：对每篇正文中的所有内嵌图片跑评分
   - 总分 ≥ 6 分的图设为该篇新 cover_image（通过 admin API 写入）
   - 没有任何图达标的文章保持原状态（继续显蓝）
   - 评估报告（每篇的图数、候选图、最高分、是否写入）保存到 `docs/superpowers/reports/2026-06-29-cover-image-eval.md`
   - 公开站 `http://localhost:5173/articles` 列表页能立即看到新封面
4. **文章 button**: admin `/admin/articles` 列表页正常渲染（不崩溃），点击"编辑"按钮能进入编辑页，点击"管理精选"能进入 featured 页面
5. **TypeScript**: `cd frontend-vite && npx tsc --noEmit` 无错误
6. **后端 smoke test**: 12 个 admin API 端点全部 200

---

## 六、执行顺序

1. **Phase 1** (并行): 任务 1 + 任务 2 + 任务 4（独立的简单修改）
2. **Phase 2**: 任务 3（依赖 admin API 写入能力，单独 subagent 处理 11 篇文章）
3. **Phase 3** (合并): tsc 检查 + smoke test + 提交

每个 phase 由独立子代理执行，主会话在 phase 之间 review 进度。

---

## 七、风险与缓解

| 风险 | 缓解 |
|---|---|
| 删除 Twitter 链接时连带删错 import | 删除前 grep 确认图标组件仅在被删处使用 |
| cover-image 评估子代理把不相关的图设为封面 | 主题相关性双层判断（关键词 + 类别） |
| admin API 写失败 | 错误聚合到报告，不静默失败 |
| ArticleList 修复后还有其他隐藏 bug | 加 Route 404 兜底 + TypeScript 编译期检查 |
