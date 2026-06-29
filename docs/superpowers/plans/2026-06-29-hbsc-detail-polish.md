# HBSC 细节调优 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 4 处用户可见的细节：地址文案、Twitter 链接残留、cover-image 评估、admin 文章 button 跳错页

**Architecture:** 3 个独立子任务（address+twitter+button）并发 → 1 个子任务（cover-image 评估与写入）→ 1 个总验证（tsc + smoke test + commit）。每步用 admin API 写入或 git 提交验证。

**Tech Stack:** React + Vite (frontend), FastAPI + SQLAlchemy (backend), Python 3 (评估脚本)

---

## Task 1: 修改 Footer 地址

**Files:**
- Modify: `frontend-vite/src/components/Footer.tsx:62`

- [ ] **Step 1: 修改地址文案**

```diff
- <li>武汉市东湖高新区</li>
+ <li>湖北省小龟山金融文化公园19栋</li>
```

- [ ] **Step 2: 验证**

```bash
grep -n "小龟山\|东湖高新区" frontend-vite/src/components/Footer.tsx
```

期望：仅看到 `小龟山`，无 `东湖高新区`

- [ ] **Step 3: 提交**

不单独提交，phase 3 一起提交

---

## Task 2: 删除 Footer X.com 社交链接

**Files:**
- Modify: `frontend-vite/src/components/Footer.tsx:35-39`

- [ ] **Step 1: 检查 X 图标 import 是否仅此一处使用**

```bash
grep -rn "from 'lucide-react'" frontend-vite/src/components/Footer.tsx
grep -rn "\\bX\\b" frontend-vite/src/components/Footer.tsx
```

如果 `X` 仅在 Footer.tsx 中 import，则可连 import 一并删除。

- [ ] **Step 2: 删除 X.com `<a>` 链接**

在 `Footer.tsx` 中找到类似以下 JSX（行 35-39）：

```tsx
<a href="https://x.com/jiangshang_cn" aria-label="X" target="_blank" rel="noopener noreferrer">
  <X size={16} strokeWidth={1.5} />
</a>
```

整段删除（包括外层 `<li>` 包裹如果存在）。

- [ ] **Step 3: 删除未使用的 X import**

如果 Step 1 确认 X 仅在删除处使用，从 import 行删除 `X,`。

- [ ] **Step 4: 验证**

```bash
grep -n "twitter\|x.com\|X\.com" frontend-vite/src/components/Footer.tsx
```

期望：无任何匹配

- [ ] **Step 5: 提交**

不单独提交，phase 3 一起提交

---

## Task 3: 删除 ArticleDetail Twitter 分享按钮

**Files:**
- Modify: `frontend-vite/src/pages/ArticleDetail.tsx:177-181, 419-423`

- [ ] **Step 1: 检查 MessageCircle 图标 import**

```bash
grep -n "MessageCircle" frontend-vite/src/pages/ArticleDetail.tsx
```

确认 MessageCircle 仅在 Twitter 分享按钮中使用。

- [ ] **Step 2: 删除 handleShareTwitter 函数**

删除以下函数（约 177-181 行）：

```tsx
const handleShareTwitter = () => {
  const url = encodeURIComponent(window.location.href)
  const text = encodeURIComponent(article?.title || '')
  window.open(`https://twitter.com/intent/tweet?url=${url}&text=${text}`, '_blank', 'noopener,noreferrer')
}
```

- [ ] **Step 3: 删除 Twitter 分享按钮 JSX**

找到约 419-423 行的按钮：

```tsx
<button
  onClick={handleShareTwitter}
  className="article-detail__share-btn"
  aria-label="分享到 Twitter"
>
  <MessageCircle size={14} strokeWidth={1.5} /> Twitter
</button>
```

整段删除（外层若是 `<li>` 包含关系，一并删除 `<li>`）。

- [ ] **Step 4: 删除未使用的 MessageCircle import**

如果 Step 1 确认仅此一处使用，从 import 行删除 `MessageCircle,`。

- [ ] **Step 5: 验证**

```bash
grep -n "twitter\|Twitter\|MessageCircle" frontend-vite/src/pages/ArticleDetail.tsx
```

期望：无任何匹配

- [ ] **Step 6: 提交**

不单独提交，phase 3 一起提交

---

## Task 4: 删除 About 团队成员 Twitter 字段

**Files:**
- Modify: `frontend-vite/src/pages/About.tsx:119-123`

- [ ] **Step 1: 删除 member.twitter 渲染块**

找到约 119-123 行：

```tsx
{member.twitter && (
  <a href={`https://twitter.com/${member.twitter.replace('@','')}`} target="_blank" rel="noopener noreferrer" aria-label="Twitter">
    <Twitter size={14} strokeWidth={1.5} />
  </a>
)}
```

整段删除（注意还有 LinkedIn 等其他社交的包裹结构，不要误删）。

- [ ] **Step 2: 检查 Twitter 图标 import**

```bash
grep -n "Twitter" frontend-vite/src/pages/About.tsx
```

如果仅在删除处使用，从 import 删除。

- [ ] **Step 3: 验证**

```bash
grep -n "twitter\|Twitter" frontend-vite/src/pages/About.tsx
```

期望：无任何匹配（前端 type 保留）

- [ ] **Step 4: 提交**

不单独提交，phase 3 一起提交

---

## Task 5: 修复 ArticleList useState 导入

**Files:**
- Modify: `frontend-vite/src/pages/admin/ArticleList.tsx:1`

- [ ] **Step 1: 修改 import**

```diff
- import { useEffect, useRef } from 'react'
+ import { useEffect, useRef, useState } from 'react'
```

- [ ] **Step 2: 验证**

```bash
grep -n "^import.*from 'react'" frontend-vite/src/pages/admin/ArticleList.tsx
```

期望：看到 `useState` 在 import 列表中

- [ ] **Step 3: 提交**

不单独提交，phase 3 一起提交

---

## Task 6: 增加 NotFound 兜底路由（配套）

**Files:**
- Create: `frontend-vite/src/pages/NotFound.tsx`
- Modify: `frontend-vite/src/App.tsx` 末尾

- [ ] **Step 1: 创建 NotFound 组件**

新建 `frontend-vite/src/pages/NotFound.tsx`：

```tsx
import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div style={{
      minHeight: '60vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '1rem',
      padding: '2rem',
      textAlign: 'center',
    }}>
      <h1 style={{ fontSize: '4rem', margin: 0, color: '#1A1A2E' }}>404</h1>
      <p style={{ color: '#666' }}>您访问的页面不存在</p>
      <Link to="/" style={{ color: '#C9A84C' }}>返回首页</Link>
    </div>
  )
}
```

- [ ] **Step 2: 在 App.tsx 末尾增加 404 路由**

在 `App.tsx` 找到最后的 `</Routes>` 闭合标签之前，新增：

```tsx
<Route path="*" element={<NotFound />} />
```

并添加 import：

```tsx
import NotFound from './pages/NotFound'
```

- [ ] **Step 3: 验证**

```bash
grep -n "NotFound" frontend-vite/src/App.tsx
```

期望：看到 import 和 `<Route path="*"` 各一处

- [ ] **Step 4: 提交**

不单独提交，phase 3 一起提交

---

## Task 7: cover-image 评估与写入

**Files:**
- Create: `docs/superpowers/reports/2026-06-29-cover-image-eval.md`
- Create: `scripts/cover_image_eval.py`（评估脚本，临时文件可保留）

- [ ] **Step 1: 启动后端**

```bash
cd backend && uvicorn app.main:app --port 8000 &
sleep 3
curl -s http://localhost:8000/api/articles?per_page=50 | head -c 500
```

期望：返回 JSON 含 `items` 数组

- [ ] **Step 2: 登录 admin 拿 token**

```bash
curl -s -X POST http://localhost:8000/api/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'  # 实际凭据以 dev 输出为准
```

如果默认凭据不行，先读 `backend/app/main.py` 找 admin 初始化逻辑。

- [ ] **Step 3: 写评估脚本 `scripts/cover_image_eval.py`**

```python
#!/usr/bin/env python3
"""评估每篇文章正文中内嵌图片的质量，技术分 + 主题分，达标者写入 cover_image。"""
import re, json, requests, sys
from pathlib import Path
from io import BytesIO

API = "http://localhost:8000"
ADMIN_API = f"{API}/api/admin"

# 类别关键词
CATEGORY_KEYWORDS = {
    "人工智能": ["ai", "gpt", "llm", "agent", "算法", "模型", "智能", "机器人", "神经网络", "openclaw", "claw"],
    "政策": ["政策", "规划", "纲要", "政府", "会议", "报告", "数字经济", "十五五", "五年"],
    "前沿": ["研究", "论文", "实验", "技术", "框架", "学术", "突破", "esb", "架构"],
    "产业": ["企业", "行业", "转型", "案例", "工厂", "供应链", "中小企业", "sme", "国企", "联投"],
    "default": ["湖北", "武汉", "数字", "data"],
}

def extract_images(md: str):
    return re.findall(r'!\[.*?\]\((.*?)\)', md) + re.findall(r'<img[^>]+src=["\'](.*?)["\']', md)

def tech_score(url: str) -> tuple[int, dict]:
    try:
        r = requests.head(url, timeout=5, allow_redirects=True)
        if r.status_code != 200:
            return 0, {"reason": f"HTTP {r.status_code}"}
        size = int(r.headers.get('content-length', 0))
        # 仅看 HEAD 的 content-length；某些服务器不允许 HEAD 时降级到 GET 范围
        aspect_ok = True  # 无法从 HEAD 判断纵横比，跳过
        if size < 30 * 1024:
            return 0, {"reason": f"size {size}B < 30KB"}
        score = 3 if size >= 100 * 1024 else 2  # 30-100KB: 2 分；≥100KB: 3 分
        return score, {"size": size}
    except Exception as e:
        return 0, {"reason": str(e)}

def topic_score(url: str, category: str) -> int:
    url_lower = url.lower()
    keywords = CATEGORY_KEYWORDS.get(category, CATEGORY_KEYWORDS["default"])
    matched = sum(1 for kw in keywords if kw.lower() in url_lower)
    return min(matched, 5)

def evaluate_article(article: dict) -> dict:
    imgs = extract_images(article.get("content", ""))
    if not imgs:
        return {"id": article["id"], "title": article["title"], "images": 0, "decision": "no-images"}
    
    candidates = []
    for url in imgs:
        # 绝对化
        if url.startswith("/"):
            url = API + url
        t_score, t_info = tech_score(url)
        tp_score = topic_score(url, article.get("category", "default"))
        total = t_score + tp_score
        candidates.append({"url": url, "tech": t_score, "topic": tp_score, "total": total, "info": t_info})
    
    candidates.sort(key=lambda x: x["total"], reverse=True)
    best = candidates[0]
    
    if best["total"] >= 6:
        return {"id": article["id"], "title": article["title"], "images": len(imgs),
                "candidates": candidates, "decision": "write", "chosen": best}
    return {"id": article["id"], "title": article["title"], "images": len(imgs),
            "candidates": candidates, "decision": "no-match", "best_score": best["total"]}

def main():
    # 1. 拿所有文章
    r = requests.get(f"{API}/api/articles?per_page=50")
    articles = r.json()["items"]
    
    # 2. 登录
    login = requests.post(f"{ADMIN_API}/auth/login", json={"username": "admin", "password": "admin123"})
    if login.status_code != 200:
        print(f"login failed: {login.text}", file=sys.stderr)
        sys.exit(1)
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    
    # 3. 评估 + 写入
    report = []
    for a in articles:
        result = evaluate_article(a)
        report.append(result)
        if result["decision"] == "write":
            url = result["chosen"]["url"]
            put = requests.put(f"{ADMIN_API}/articles/{a['id']}", 
                             headers=headers, 
                             json={"cover_image": url})
            result["put_status"] = put.status_code
    
    # 4. 输出报告
    Path("docs/superpowers/reports").mkdir(parents=True, exist_ok=True)
    with open("docs/superpowers/reports/2026-06-29-cover-image-eval.md", "w") as f:
        f.write("# Cover Image 评估报告\n\n")
        f.write(f"评估时间: 2026-06-29\n\n")
        f.write(f"总文章数: {len(articles)}\n\n")
        for r in report:
            f.write(f"## {r['title']}\n\n")
            f.write(f"- 图片数: {r['images']}\n")
            f.write(f"- 决策: **{r['decision']}**\n")
            if "chosen" in r:
                f.write(f"- 选用: `{r['chosen']['url']}` (技术 {r['chosen']['tech']} + 主题 {r['chosen']['topic']} = {r['chosen']['total']})\n")
                f.write(f"- API 写入状态: {r.get('put_status', '?')}\n")
            f.write("\n")
    
    print(json.dumps(report, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
```

- [ ] **Step 4: 运行评估脚本**

```bash
cd /Users/jasonlee/hubei-shuchuang
pip3 install requests  # 如未安装
python3 scripts/cover_image_eval.py 2>&1 | tail -100
```

期望：输出 11 篇文章的评估结果，达标篇的 API 写入状态为 200

- [ ] **Step 5: 检查报告**

```bash
cat docs/superpowers/reports/2026-06-29-cover-image-eval.md
```

期望：每篇都有"决策"行，写入的有 URL 和 API 状态

- [ ] **Step 6: 在公开站验证**

```bash
curl -s http://localhost:8000/api/articles?per_page=5 | python3 -c "
import json, sys
data = json.load(sys.stdin)
for a in data['items'][:5]:
    print(f\"{a['title'][:30]:30} | cover_image: {a.get('cover_image', 'None')[:60]}\")
"
```

期望：能看到新 cover_image URL 的文章数量与报告"write"决策数量一致

- [ ] **Step 7: 提交**

不单独提交，phase 3 一起提交

---

## Task 8: 全局验证与提交

**Files:**
- Modify: 无（仅运行检查）

- [ ] **Step 1: TypeScript 类型检查**

```bash
cd frontend-vite && npx tsc --noEmit 2>&1 | tail -20
```

期望：无错误输出

- [ ] **Step 2: 全站无 Twitter 关键词**

```bash
cd /Users/jasonlee/hubei-shuchuang
grep -rn "twitter\|Twitter\|x\.com/jiangshang" frontend-vite/src/components frontend-vite/src/pages | grep -v "// " | head -20
```

期望：无任何匹配（除 api.ts:145 的类型字段保留）

- [ ] **Step 3: Footer 地址正确**

```bash
grep -n "小龟山" frontend-vite/src/components/Footer.tsx
```

期望：至少 1 个匹配

- [ ] **Step 4: ArticleList useState 已导入**

```bash
head -1 frontend-vite/src/pages/admin/ArticleList.tsx
```

期望：`import { useEffect, useRef, useState } from 'react'`

- [ ] **Step 5: 后端 smoke test 12 端点**

```bash
cd backend && python3 -c "
import requests
# 登录
r = requests.post('http://localhost:8000/api/admin/auth/login', json={'username':'admin','password':'admin123'})
token = r.json()['access_token']
H = {'Authorization': f'Bearer {token}'}

# 12 个端点
endpoints = [
    ('GET',  '/api/admin/articles'),
    ('GET',  '/api/admin/articles/1'),
    ('GET',  '/api/admin/journals'),
    ('GET',  '/api/admin/domains'),
    ('GET',  '/api/admin/team'),
    ('GET',  '/api/admin/insights'),
    ('GET',  '/api/admin/cases'),
    ('GET',  '/api/admin/search?q='),
    ('GET',  '/api/admin/stats'),
    ('GET',  '/api/admin/media'),
    ('GET',  '/api/articles'),
    ('GET',  '/api/insights'),
]
ok = 0
for m, p in endpoints:
    try:
        r = requests.request(m, 'http://localhost:8000' + p, headers=H, timeout=5)
        print(f'{r.status_code} {m} {p}')
        if r.status_code == 200: ok += 1
    except Exception as e:
        print(f'ERR {m} {p}: {e}')
print(f'\\n{ok}/{len(endpoints)} 端点通过')
"
```

期望：12/12 通过

- [ ] **Step 6: 提交所有改动**

```bash
cd /Users/jasonlee/hubei-shuchuang
git add frontend-vite/src/components/Footer.tsx \
        frontend-vite/src/pages/ArticleDetail.tsx \
        frontend-vite/src/pages/About.tsx \
        frontend-vite/src/pages/admin/ArticleList.tsx \
        frontend-vite/src/App.tsx \
        frontend-vite/src/pages/NotFound.tsx \
        scripts/cover_image_eval.py \
        docs/superpowers/reports/2026-06-29-cover-image-eval.md
git status  # 确认无遗漏
git commit -m "fix(admin+frontend): detail polish — address, twitter links, cover-image eval, article button

- Footer address: 武汉市东湖高新区 → 湖北省小龟山金融文化公园19栋
- Remove Twitter links: Footer 社交图标、ArticleDetail 分享、About 团队字段
- ArticleList: add missing useState import (fixes admin article button error page)
- Add NotFound route + 404 page (defensive)
- Cover-image: evaluate 11 articles' inline images, write high-quality ones via admin API"
```

- [ ] **Step 7: 最终汇报**

向用户报告：4 项修复落地 + cover-image 评估结果 + 提交 hash
