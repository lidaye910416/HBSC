# Docx 导入后自动 AI 排版 — 设计

> 增量补丁：在已被锁定的 `2026-06-30-ai-typesetting-design.md` 之上，把 `.docx` 导入与 AI 排版接到一个开关上。**不**新建后端端点、**不**修改提示词、**不**修改 `TypesetPreviewDialog`、**不**修改既有 AI 排版按钮行为。

---

## 目标

让管理员在 `/admin/articles/:id`（以及 `/admin/articles/new`）页面里：

- 上传 `.docx` → 既有的 pandoc → markdown 流程 → 表单填好
- **若**勾选"导入后自动跑 AI 排版" → 紧接着自动调用既有的 `handleTypeset()` → 既有的 `TypesetPreviewDialog` 自动打开
- **未**勾选 → 行为完全不变；管理员可以单独点既有的"AI 排版"按钮

两种 markdown 来源（Word import / 既存 markdown）共用同一个 AI 排版能力，不引入第二份代码路径。

---

## 非目标

- ❌ 改动 `POST /api/admin/articles/typeset` 后端端点
- ❌ 改动 `markdown_typesetter.py` 服务、`ADMIN_TYPESETTER_*` AdminSetting 配置、或 prompt
- ❌ 改动 `TypesetPreviewDialog` 任何已有交互
- ❌ 改动"AI 排版"独立按钮行为
- ❌ 自动保存（点 Apply 之后不写 DB，仍由管理员手动点"保存草稿/保存并发布"）
- ❌ 引入第二个对话框、第二种样式、第二种 rate limit
- ❌ Word 导入之外的文件类型（pdf / md / txt 等）

---

## 关键决策

| 决策点 | 选定值 | 理由 |
|---|---|---|
| 触发粒度 | 文件级（一次导入 = 一次自动跑） | 一个 docx 对应一段 markdown，不需要按段多次 |
| 默认勾选 | **勾选**，但**仅在 typesetter 已配置时** | typesetter 没配就隐藏/禁用，避免无效调用 |
| 持久化 | `localStorage['hbsc-article-auto-typeset']` | 跨会话记住选择；与服务端设置解耦 |
| 失败行为 | 弹窗里显示既有的红色 warning 与 toast，与单独点 AI 排版按钮一致 | 复用现有错误 UX |
| 用户反悔 | 既有的 Revert / 关闭 / Apply 按钮已经处理 | 不增加新控件 |

---

## 数据流

```
┌─ 类型 1：仅导入（checkbox 未勾选） ─────────────────────────┐
│ upload .docx                                                 │
│   → POST /api/admin/articles/import-docx                     │
│   → pypandoc → markdown                                      │
│   → form.content = markdown                                  │
│   → 结束（行为完全不变）                                     │
└──────────────────────────────────────────────────────────────┘

┌─ 类型 2：导入并 AI 排版（checkbox 勾选 & typesetter 已配置） ─┐
│ upload .docx                                                 │
│   → POST /api/admin/articles/import-docx                     │
│   → pypandoc → markdown                                      │
│   → form.content = markdown                                  │
│   → 自动 await handleTypeset(form.content)                   │
│   → POST /api/admin/articles/typeset                         │
│   → TypesetPreviewDialog 自动打开（与单独点按钮路径同源）   │
│   → Apply → form.content = cleaned                           │
└──────────────────────────────────────────────────────────────┘

┌─ 类型 3：既存 markdown 排版（独立按钮，不变） ────────────────┐
│ 已有内容 → 点 AI 排版按钮 → handleTypeset → 弹窗           │
└──────────────────────────────────────────────────────────────┘
```

所有三种类型汇合到同一函数 `handleTypeset` 与同一对话框 `TypesetPreviewDialog`，无分支。

---

## 文件级改动清单

### `frontend-vite/src/pages/admin/ArticleEditor.tsx`（仅此一处）

1. 加一个 state：`const [autoTypeset, setAutoTypeset] = useState(() => localStorage.getItem('hbsc-article-auto-typeset') !== 'false')`
2. 当 state 变化时 `useEffect` 写回 `localStorage`
3. 在 `handleImportDocx` 末尾（成功后），若 `autoTypeset && typesetterReady`，`await handleTypeset(form.content)` —— 与管理员手动点 AI 排版按钮同源
4. JSX 改动：`.docx` 块（第 333–349 行附近）下方加一行 checkbox：
   ```tsx
   {typesetterReady && (
     <label className="article-editor__autotypeset">
       <input
         type="checkbox"
         checked={autoTypeset}
         onChange={(e) => setAutoTypeset(e.target.checked)}
       />
       导入并自动跑 AI 排版
     </label>
   )}
   {!typesetterReady && (
     <small className="article-editor__autotypeset-hint">
       （如需导入后自动跑 AI 排版，请先在「设置 → AI 排版」中启用并配置 API Key）
     </small>
   )}
   ```

**其他文件全部不动：**

- `backend/app/services/markdown_typesetter.py` — 不变
- `backend/app/routers/admin_articles_typeset.py` — 不变
- `frontend-vite/src/components/admin/TypesetPreviewDialog.tsx` — 不变
- `frontend-vite/src/services/api.ts` — 不变
- `frontend-vite/src/components/admin/Mde/*` — 不变

---

## 边界与失败处理

| 场景 | 行为 |
|---|---|
| typesetter 未启用 / 缺 api_key | checkbox 不渲染，改为一行灰字提示；行为退回"类型 1" |
| LLM 调用失败（502 等） | 由既有 `handleTypeset` 的 `catch` 处理：表单下方红字 + toast.error；管理员可重试或继续不排版 |
| 用户在弹窗点 Revert / 关闭 | 既有逻辑回滚到 `appliedSnapshotRef` 或跳过 Apply；不影响 checkbox 状态 |
| `localStorage` 写入失败（如隐私模式） | state 仍生效，仅会话内有效，无需告警 |
| 并发：管理员在弹窗打开时再次导入 docx | 弹窗会被新一次 `setTypesetDialog` 覆盖；既有单一对话框状态机已经正确处理 |
| checkbox 持久化读不到（首访） | 默认 `true`，首次导入即触发，符合"已配置 typesetter 的用户期望更省事"的直觉 |

---

## 测试计划

**新增**（本改动专属，全部 frontend）：

1. `frontend-vite/tests/article-autotypeset.spec.ts`
   - 用例 A：勾选时上传 docx → 断言 `TypesetPreviewDialog` 出现且 `form.content` 仍为 raw pandoc 输出（直到 Apply 才覆盖）
   - 用例 B：取消勾选 → 上传 → 断言 dialog **不**自动打开
   - 用例 C：typesetter 未启用 → 断言 checkbox 不渲染，导入后 form 仍为 raw
   - 用例 D：刷新页面后 checkbox 状态从 `localStorage` 还原

2. 单元（vitest，如已配）：
   - `useState` 初始值来自 `localStorage`：以 `localStorage` 的 `'true'`/`'false'` 两种分别测试

**保留**（既有覆盖，本改动不破坏）：

- `backend/tests/test_markdown_typesetter.py`、`test_admin_articles_typeset.py`、`test_markdown_typesetter_style.py` 全部继续通过
- `frontend-vite/tests/ai-typesetter-dialog.spec.ts`（既有 Playwright）继续覆盖按钮路径

---

## 与 2026-06-30 锁定 spec 的关系

| 锁定 spec 决策 | 本补丁是否影响 |
|---|---|
| 范围仅限 markdown 清理 | 不影响（仍是同一 endpoint） |
| 手动按钮触发 | 强化而非破坏：现在多一个可选的自动触发，管理员永远可以选择单点按钮 |
| 配置命名空间 `article_typesetter.*` | 不影响（共用同一组配置） |
| 输出体验：预览 → Apply | 不影响（弹窗复用） |
| MiniMax 预设 | 不影响 |

**全部既有约束（Fenet 加密、密钥不外泄、5/min rate limit、32k 字符截断、1MB 体积上限、style overlay、`_strip_fences/_strip_think_block` 防御）原样保留。**

---

## 范围外

- 期刊编辑器（`JournalEditor.tsx`）目前没有 markdown body 字段——不在本次范围
- 流式输出、自动保存、定时任务：明确不出现在本次
- 单元测试外的端到端脚本：沿用既有的 `scripts/smoke_typeset.py`
