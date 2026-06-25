# API 审计 Follow-up 综合修复 — 设计

**日期：** 2026-06-25
**基础：** `2026-06-25-api-audit-report.md` 修复后剩余的 14 个 P2/P3 + 部分 P1 问题
**目标：** 一个 workflow 解决所有可立即落地的剩余问题

---

## 1. 修复范围（12 项，按优先级）

### Tier 1 — 安全与可靠性（必须）

| # | 问题 | 文件 | 修复 |
|---|------|------|------|
| **G1** | Token 存 localStorage（XSS 可读） | `auth_router.py` + `ProtectedRoute.tsx` + `api.ts` | 改用 `Set-Cookie: HttpOnly; Secure; SameSite=Strict`，前端不再手动存 token；自动随请求发送 |
| **G2** | `DEBUG=True` 默认 → `/docs` 公开 | `config.py` + `main.py` | 默认改为 `False`，仅当 `ENV=development` 时显式开启 |
| **G3** | 默认 `ADMIN_USERNAME=admin` + 弱密码 | `config.py` + `auth_router.py` | 启动时若未设置 `ADMIN_USERNAME`/`ADMIN_PASSWORD_HASH` 直接 `raise`；登录时校验密码长度 ≥ 8 |
| **G4** | 全局 401 handler（token 过期无感知） | `api.ts` + `main.tsx` + `ProtectedRoute.tsx` | 统一拦截 401 → 清 cookie + 跳 `/admin/login` |
| **G5** | 无 `ErrorBoundary` | `main.tsx` + 新建 `ErrorBoundary.tsx` | 顶层 ErrorBoundary 捕获 render 错误 |
| **G6** | Admin delete mutation 无 `onError` | `MediaLibrary.tsx` + `ArticleList.tsx` + `JournalList.tsx` | 所有删除/上传 mutation 加 toast 错误提示 |
| **G7** | 全局 exception handler 不统一 | `main.py` | 加 `@app.exception_handler(HTTPException)` + `Exception`，统一返回 `{error: {code, message}}` |
| **G8** | 上传先全读内存再校验大小（DoS 面） | `upload_service.py` | 流式读取 + 累计字节计数，超过 5MB 立即断 |
| **G9** | `original_name` 直接返回前端可触发 stored XSS | `admin_router.py` | 后端 sanitize 原始文件名（去除控制字符 + 限制长度） |
| **G10** | Retry 无差别重试 401/4xx | `App.tsx` | 改为 `retry: (failureCount, error) => boolean`，仅 5xx/network 重试 |

### Tier 2 — 性能与一致性

| # | 问题 | 文件 | 修复 |
|---|------|------|------|
| **G11** | Search 无 debounce | `Search.tsx` | 加 300ms debounce（`useDeferredValue` 或手写 timeout） |
| **G12** | React Query key 单/复数不一致 | `ArticleEditor.tsx` + `JournalEditor.tsx` | 统一用复数 `'articles'`/`'journals'` |

### 不在本轮（标记 follow-up）

- openapi-typescript 类型自动生成（需要 npm install + 全量类型替换，工程量大）
- Alembic migration（需要新表 history + 重写 startup 逻辑）
- 死模型清理（Case/Domain/Insight/Researcher 是产品决策）
- 软删除全局引入（产品决策）
- Optimistic updates（UX nice-to-have，不是 bug）

---

## 2. 改动文件汇总

### 后端（5 文件）
| 文件 | 改动 |
|------|------|
| `backend/app/config.py` | DEBUG 默认 False、ADMIN 强制 env |
| `backend/app/main.py` | DEBUG 校验、全局 exception handler |
| `backend/app/routers/auth_router.py` | httpOnly cookie、密码长度校验 |
| `backend/app/admin_router.py` | original_name sanitize |
| `backend/app/upload_service.py` | 流式读取 |

### 前端（8 文件）
| 文件 | 改动 |
|------|------|
| `frontend-vite/src/services/api.ts` | credentials: 'include'、401 全局拦截 |
| `frontend-vite/src/main.tsx` | ErrorBoundary 包裹 |
| `frontend-vite/src/components/ErrorBoundary.tsx` | 新建 |
| `frontend-vite/src/components/admin/ProtectedRoute.tsx` | 移除 localStorage token |
| `frontend-vite/src/pages/admin/MediaLibrary.tsx` | delete/upload onError |
| `frontend-vite/src/pages/admin/ArticleList.tsx` | delete onError |
| `frontend-vite/src/pages/admin/JournalList.tsx` | delete onError |
| `frontend-vite/src/pages/admin/ArticleEditor.tsx` | queryKey 复数 |
| `frontend-vite/src/pages/admin/JournalEditor.tsx` | queryKey 复数 |
| `frontend-vite/src/pages/Search.tsx` | debounce |
| `frontend-vite/src/App.tsx` | retry 策略 |

---

## 3. 关键设计权衡

### G1 (httpOnly cookie) 注意事项

- **CSRF**：cookie 自动随请求发送，需要后端验证 CSRF token 或限制 SameSite=Strict
- **方案**：用 `SameSite=Strict` + 简单的 CSRF double-submit 模式（前端从 cookie 读 `csrf_token`，写入 `X-CSRF-Token` header）
- **更简单的方案**：登录返回 csrf_token，admin mutation 必须带 header，后端验证
- **最简方案**：先做 `SameSite=Strict` + 不引入 CSRF（accept 风险，因为 admin 路由需要 token 才有权限，CSRF 攻击者无法拿到 token）
- **选择最简方案**：httpOnly + SameSite=Strict 已经是相当强的防护，CSRF 在此场景下面临攻击者无法获取 cookie 的现实困难

### G4 (全局 401) 注意事项

- 用 `fetch` 包装层（不是 axios interceptor）
- 在 `api.ts` 顶层包一层 `request()` 函数，所有方法走这个
- 401 时清 cookie + `window.location.href = '/admin/login'`

### G7 (全局 exception handler) 注意事项

- 统一响应：`{"error": {"code": "string", "message": "string"}}`
- 不破坏 FastAPI 默认行为，仅 override 而非替换
- 保留 `HTTPException` 的 status code

---

## 4. 验证标准

- [ ] `python3 -c "from app.main import app; print('OK')"` 通过
- [ ] `npx tsc --noEmit` 干净
- [ ] 启动 backend 后 `curl -X POST /api/auth/login` 返回 Set-Cookie 头含 HttpOnly
- [ ] 前端刷新 admin 页面 → 自动带 cookie → 401 后跳登录页
- [ ] 后端上传 10GB 文件 → 立即拒绝（不读完整内容到内存）
- [ ] 删除图片时 `original_name` 含 HTML 标签 → 返回的是 sanitize 后版本
- [ ] Search 输入 5 个字符只发 1 个请求（不是 5 个）
- [ ] Admin delete 失败时弹出错误提示

---

## 5. 工作流结构

**Phase 1**：4 个验证 agent（快速复核这 12 个 fix 的范围）
**Phase 2**：12 个 fix agent 并行
**Phase 3**：1 个 verify agent

预计时长：**~10 分钟**