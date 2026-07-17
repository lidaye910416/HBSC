# 文章正文图片、统一媒体库与按期文章管理设计

> 日期：2026-07-13  
> 状态：已通过多视角自审，等待用户书面规范复核  
> 范围：指定文章图片修复、后台统一媒体资产、Markdown 编辑器插图、历史媒体盘点、`/admin/articles` 按期数管理

## 1. 背景与目标

本设计解决三个相互关联的问题：

1. 文章 `2026-q2-plan-hongan-medical-v1` 的原始 Word 文档包含图片，上传目录也存在对应文件，但公开正文没有渲染任何图片。
2. 后台媒体库、文章正文、文章封面、期刊封面和 Word 导入图片之间没有统一的资产身份与引用关系；在 Markdown 编辑器中粘贴图片也不会自动上传或进入媒体库。
3. `/admin/articles` 只能查看全局文章列表，不能按“第一期、第二期”等期数切换管理，文章编辑器也不能可靠显示和调整所属期数。

目标如下：

- 恢复指定文章原 Word 中的全部四张图片，位置和说明以正文现有“图1～图4”为准。
- 将正文图、文章封面、期刊封面、Word 导入图和历史上传文件纳入统一媒体资产模型。
- 保持文章正文为标准 Markdown，同时可靠记录每张本站图片的使用位置。
- 支持在 Markdown 编辑器中粘贴、拖放、上传和从媒体库选择图片。
- 为被引用媒体提供删除保护，为未引用媒体提供可恢复回收站。
- 将现有上传文件全量盘点并分类，但迁移期间不移动或自动删除任何历史文件。
- 在 `/admin/articles` 通过顶部期数切换管理全部文章、各期文章和未归期草稿。

## 2. 已确认现状与根因

### 2.1 指定文章正文没有图片节点

当前有效本地数据库是 `backend/research.db`。文章 `id=19`、slug 为 `2026-q2-plan-hongan-medical-v1`，正文长度为 8,927 个字符。正文中：

- Markdown 图片节点为 0；
- HTML `<img>` 节点为 0；
- 存在四处普通文字格式的路径说明：

  ```md
  （图像路径：/uploads/source-images/19-hongan-medical/image1.png）
  ```

  路径分别指向 `image1.png` 至 `image4.png`。

四张 PNG 均存在于 `backend/uploads/source-images/19-hongan-medical/`，通过当前 Vite `/uploads` 代理请求时均返回 HTTP 200。原始 Word 文档也确认包含四张内嵌图片。

公开文章 API 返回的正文与数据库内容一致。前台使用 ReactMarkdown，仅标准 Markdown 图片节点会进入自定义 `<img>` 渲染流程。普通文字中的 `/uploads/...` 不会被解释为图片。因此根因是**历史内容转换把图片标记降级成了普通“图像路径”文字**，而不是图片文件缺失、CSS 隐藏、Vite 代理失败或期数归属错误。

当前仓库中的 DOCX 导入器会生成标准 Markdown 图片语法，编辑器的自定义上传命令也会生成 `![alt](url)`；仓库没有代码生成“图像路径”这段文字，也没有审计记录证明是哪次历史导入或人工处理造成了降级。

### 2.2 当前媒体目录和媒体库不是同一数据集合

当前上传树约有 247 个文件（不含 `.gitkeep`），主要分布为：

- `YYYY/MM`：47 个；
- `article-covers`：20 个；
- `imports`：100 个；
- `source-images`：78 个；
- uploads 根目录：2 个。

现有 `ArticleImage` 表只有 12 条标准上传记录。正文、文章封面和期刊封面只保存 URL 字符串，未与 `ArticleImage` 建立关系。媒体库因此看不到大部分 Word 导入图、source-images 和封面，也无法可靠回答“被哪些文章使用”。

现有普通媒体删除还存在路径不一致：上传写入 `uploads/YYYY/MM/<filename>`，删除却检查 `uploads/<filename>`。删除记录时通常不会删除实际嵌套文件；同时删除前也不检查正文或封面引用。

### 2.3 当前 Markdown 编辑器不能管理粘贴图片

`ArticleEditor` 使用受控的 `@uiw/react-md-editor`。当前：

- 自定义工具栏上传可以上传文件并插入 Markdown；
- 默认图片命令只能围绕 URL 生成 Markdown；
- 没有应用级 `onPaste` 或 `onDrop` 图片处理；
- 粘贴剪贴板图片不会自动上传或插入图片 Markdown；
- 粘贴普通 URL 只会保留为文本或链接；
- 编辑器不能从媒体库选择已有图片；
- Word 导入图片未进入统一媒体资产与引用模型；
- 后台预览与公开文章详情页已共用 `frontend-vite/src/components/ArticleBody.tsx`；剩余风险是该组件仍含旧 `media/...` 路径重写规则，需与新的规范 URL 和引用同步规则保持一致。

`class="w-md-editor-content"` 的 `<div>` 只是编辑器容器，实际输入发生在内部 `<textarea>`。粘贴和拖放逻辑必须通过编辑器提供的 textarea 属性及相应事件接入，不能仅绑定外层 div。

### 2.4 当前文章列表没有期数管理

`Article.journal_id -> Journal.id` 已经是文章所属期数的关系。当前本地数据有两期、19 篇文章：第一期 11 篇、第二期 8 篇、没有未归期文章。

但是：

- `/admin/articles` 没有期数筛选或期数列；
- `ArticleEditor` 没有可见的所属期数字段，普通编辑流程也没有可靠回填期数；
- 从期刊详情页创建文章时虽可通过 `journal_id` 预选，但不能在普通编辑中重新归期；
- 前端文章列表发送 `status`，后端当前读取 `status_`，状态筛选契约不一致。

## 3. 已确认的产品决策

本设计采用以下已确认决策：

1. 指定文章恢复全部四张原图，现有“图1～图4”作为权威位置和说明。
2. 正文图片成为可复用、可追踪引用关系的统一媒体资产。
3. 编辑器支持粘贴图片、拖放图片、工具栏上传和选择媒体库图片。
4. 删除采用“引用保护 + 回收站”；被引用媒体不能删除。
5. 全量盘点现有媒体；已引用文件纳入正式资产，无法确认用途的文件标记为未使用/待认领，不自动删除。
6. `/admin/articles` 使用顶部期数切换。
7. 文章允许在编辑器中重新归期；草稿可以未归期，发布前必须归期。
8. 编辑器通过右侧媒体抽屉选择已有图片。
9. 技术方案采用“标准 Markdown + 独立媒体引用表”，不在正文中引入专有资产语法。

## 4. 范围与非目标

### 4.1 本次范围

- 新增统一媒体资产和媒体引用数据模型；
- 兼容并迁移现有 `ArticleImage` 数据；
- 盘点并登记 uploads 下的现有文件；
- 修复媒体上传、查询、删除、恢复和引用保护；
- 打通文章正文、文章封面、期刊封面和媒体资产；
- 打通 Markdown 编辑器的四种插图入口；
- 将 Word 导入图片登记为媒体资产；
- 核对并测试现有共享 `ArticleBody` Markdown 渲染组件；
- 定向修复文章 19 的四张图；
- 为后台文章列表和文章编辑器增加期数管理。

### 4.2 非目标

- 不在本次迁移中移动或重命名历史文件；
- 不自动合并相同哈希的历史图片；
- 不自动删除任何未引用历史文件；
- 不管理外部 `https://...` 图片的生命周期；
- 不引入 `media://id` 等专有 Markdown 语法；
- 不加入 AI 图片说明、OCR 或智能裁剪；
- 不把重复前导斜杠 `//articles/...` 路由问题混入图片修复；
- 不在本次改动中移除旧 `article_images` 表；
- 不修改现有期刊四栏目分类和期刊发布完整性规则；
- 本期统一 `MediaUsage` 归属仅覆盖 Article 正文、Article 封面与 Journal 封面；`Case.cover_image` 和 Insight 媒体暂缓；
- 现有 CSV 表格上传兼容路径不进入图片 `MediaAsset`；现有生成图片能力保留，并登记为 `source=generated`。

## 5. 统一媒体资产架构

### 5.1 `MediaAsset`

`MediaAsset` 表示一个可独立管理的本站媒体文件。

| 字段 | 类型/约束 | 含义 |
|---|---|---|
| `id` | 主键 | 稳定资产 ID |
| `storage_path` | 唯一、非空 | 相对 uploads 根目录的不可变路径，例如 `2026/07/uuid.png` |
| `original_name` | 非空 | 原始文件名或迁移时推导的名称 |
| `mime_type` | 非空 | 由实际文件内容识别的 MIME |
| `byte_size` | 非空 | 文件字节数 |
| `width` / `height` | 可空 | 图片像素尺寸；无法读取时为空并标记健康异常 |
| `sha256` | 非空、索引 | 内容哈希，用于诊断重复文件，不作为自动合并依据 |
| `source` | 非空 | `paste`、`drop`、`upload`、`docx`、`legacy`、`cover`、`generated` |
| `source_ref` | 可空 | DOCX 导入请求 ID、历史目录或其他简短来源标识 |
| `status` | 非空 | `active` 或 `trashed` |
| `uploaded_by` | 非空；仅未知历史来源可空 | 新资产必须记录已认证管理员；历史迁移无法确认上传人时可为空 |
| `created_at` | 非空 | 创建或迁移登记时间 |
| `trashed_at` | 可空 | 进入回收站时间 |

`source` 是由服务端设置且不可修改的创建来源：

- 编辑器粘贴、拖放和工具栏上传分别写入 `paste`、`drop`、`upload`；
- DOCX 图片提取写入 `docx`；
- 历史盘点与迁移写入 `legacy`；
- 文章/期刊专用封面上传接口写入 `cover`；
- 现有 `/api/admin/media/generate` 生成的图片写入 `generated`。

选择已有资产作为封面只会新增 `cover_image` usage，不改变资产原始 `source`。新建非 legacy 资产必须记录当前已认证管理员；仅无法确认上传人的历史资产允许 `uploaded_by=NULL`。允许 PNG、JPEG、WebP 和 GIF，最终 MIME 与扩展名从校验后的真实格式推导。`sha256` 只用于诊断，值不唯一；内容相同的文件仍可保留为不同资产，不自动合并。

公共 URL 始终由 `storage_path` 生成：

```text
/uploads/{storage_path}
```

数据库不再依靠 `uploaded_at` 的年月反推物理路径。`storage_path` 是文件查询、公开 URL、删除和恢复的唯一权威路径。

### 5.2 `MediaUsage`

`MediaUsage` 表示一个资产在站内实体中的使用关系。

| 字段 | 类型/约束 | 含义 |
|---|---|---|
| `id` | 主键 | 使用记录 ID |
| `asset_id` | 外键、索引 | 指向 `MediaAsset` |
| `owner_type` | 非空 | `article` 或 `journal` |
| `owner_id` | 非空、索引 | 文章或期刊 ID |
| `field` | 非空 | `content` 或 `cover_image` |
| `reference_count` | 非空、默认 1 | 同一字段中该资产出现次数 |
| `created_at` / `updated_at` | 非空 | 审计时间 |

唯一约束：

```text
(asset_id, owner_type, owner_id, field)
```

`MediaUsage.asset_id` 是指向 `media_assets.id` 的真实外键，使用 `ON DELETE RESTRICT`；SQLite 必须开启 foreign-key enforcement。由于 `(owner_type, owner_id)` 是多态归属，`owner_id` 只建立索引，不声明数据库外键。`owner_type` 与 `field` 使用 CHECK 约束，只允许以下组合：

```text
(article, content)
(article, cover_image)
(journal, cover_image)
```

同一张图在同一篇正文出现多次时只保留一条 usage，并更新 `reference_count`。

### 5.3 正文引用同步

文章正文继续保存标准 Markdown：

```md
![红安县数字医共体总体架构](/uploads/source-images/19-hongan-medical/image1.png)
```

后端增加 `markdown-it-py` 依赖，通过 Markdown AST 的 image token 提取图片，不用正则猜测普通文字。图片 URL 按以下规则分类：

1. 跳过 `data:`、协议相对 `//...`、外部 HTTP(S) 和未知相对 URL，不为其创建 usage；
2. 对严格以 `/uploads/` 开头的 URL：
   - 使用 `urllib.parse.urlsplit(url).path`；
   - percent-decode 路径，丢弃 query 和 fragment；
   - 去掉 `/uploads/` 前缀并转为 POSIX 分隔符；
   - 拒绝反斜杠、空段、`.` 和 `..`；
   - 对绝对 uploads 根目录解析并校验 containment；
3. 对现有可识别的 `media/...` 图片节点，使用与 `ArticleBody` 相同的 legacy slug→目录映射得到 `/uploads/...` 后再匹配；不得生成新的 `media/...` Markdown。

文章创建或更新时，在同一数据库事务内：

1. 保存/flush 文章，取得文章 ID；
2. 提取并规范化本站图片路径；
3. 按 `storage_path` 匹配 active 且 healthy 的 `MediaAsset`；
4. 计算本次期望 usage 集合；
5. 新增缺失 usage、更新重复次数、删除已不再出现的 usage；
6. 完成文章与 usage 的同一事务提交。

交互式文章保存遇到无法匹配的本站图片时返回 `422 unknown_media_asset`；匹配到 trashed、missing_file 或 invalid_image 资产时返回 `422 unavailable_media_asset`，文章与 usage 变更全部回滚。迁移只报告这类异常，不自动重写。DOCX 导入必须先为每个提取文件创建 `MediaAsset(source=docx)`，再返回包含其 URL 的 Markdown。

外部 HTTP(S) 图片仍可渲染，但不创建 `MediaUsage`。原始 HTML `<img>` 不作为支持的正文格式，因为渲染器未启用 raw HTML。

### 5.4 封面引用同步

- `Article.cover_image` 建立 `MediaUsage(article, article_id, cover_image)`；
- `Journal.cover_image` 建立 `MediaUsage(journal, journal_id, cover_image)`；
- 替换或清空封面只解除旧 usage，不立即删除或回收资产；
- 删除文章时，在同一事务中先显式删除该文章的全部 usage，再删除文章；
- 删除期刊时，在同一事务中先删除期刊封面 usage，并删除即将由现有期刊→文章级联移除的所有文章 usage，再删除期刊；
- 资产与文件永不随 owner 级联删除。

## 6. 媒体生命周期与删除安全

### 6.1 上传

统一上传 helper 只负责校验与写入文件，**不得调用 `db.commit()`**。流程为：

1. 检查管理端认证与 5 MB 限制；
2. 在最终 `YYYY/MM` 目录内创建唯一临时文件，确保后续替换位于同一文件系统；
3. 写入、flush 并 `fsync`；
4. 使用 Pillow `verify()` 校验，再重新打开读取尺寸；不以扩展名作为识别失败时的兜底；
5. 只允许 PNG、JPEG、WebP、GIF，并从验证后的格式推导 MIME 与最终扩展名；
6. 计算大小和 SHA-256；
7. 生成唯一 `YYYY/MM/<uuid>.<detected-ext>` 路径；
8. 使用 `os.replace` 将临时文件原子移动到最终路径；
9. 返回文件元数据给调用方，不自行提交数据库。

uploads 根、目录、临时路径、最终路径和读取自 `storage_path` 的路径全部经过同一个 `resolve_inside_uploads` helper 校验后才可访问。调用方在自己的事务中创建 `MediaAsset`、记录 `uploaded_by` 并提交；事务失败时尝试删除刚生成的最终文件，清理失败必须记录错误并进入后续对账。

文章/期刊专用封面上传在同一数据库事务中完成新文件资产、owner 封面字段和新 usage；只移除旧 usage，不 unlink 旧封面。现有普通图片上传、生成图片、DOCX 图片以及文章/期刊封面设置和清空路径全部改为使用该服务，移除扩展名兜底、直接向最终路径写入、helper 内部 commit 和旧封面硬删除逻辑。文件系统与数据库无法形成一个真正的原子事务，因此设计只承诺明确的补偿清理和可审计异常，不宣称二者原子提交。

### 6.2 引用保护、回收与恢复

- 删除 active 资产前查询 `MediaUsage`；
- 存在引用时返回 `409 Conflict`，并返回具体文章/期刊、字段和标题；
- 无引用时将状态改为 `trashed`，设置 `trashed_at=NOW`；
- 回收站期间文件保持原路径，保证恢复时 URL 不变；
- trashed 资产不能被媒体选择器插入或建立新 usage；
- 恢复设置 `status=active`、`trashed_at=NULL`；再次回收会重新设置 `trashed_at=NOW` 并重新开始保留期；
- owner 删除、封面替换/清空和正文移除引用都只让资产保持 active 且变为未使用，绝不自动回收；
- `MEDIA_TRASH_RETENTION_DAYS` 默认 30 天。

本迭代不增加自动调度器。到期只代表可由管理员调用 `/purge`，或运行：

```bash
python -m app.scripts.purge_media plan
python -m app.scripts.purge_media apply
```

永久清理与文章保存、回收、恢复共用 SQLite 写串行化规则。`purge` 在 unlink 前于 `BEGIN IMMEDIATE` 中再次检查状态、保留期和零 usage：

- unlink 失败：保留 trashed 记录并报告；
- 文件已不存在：记录事实后删除符合条件的记录；
- unlink 成功但数据库删除失败：保留/报告 `missing_file` 记录，交给对账修复；
- 重复执行应幂等。

文件删除与数据库提交不是原子操作，必须用上述失败状态与审计记录恢复，而不是宣称完全原子。

### 6.3 健康状态

媒体列表和详情返回派生健康状态，不在数据库另存缓存：

- `healthy`：记录和文件均存在，且通过 Pillow 校验；
- `missing_file`：记录存在但文件缺失；
- `invalid_image`：文件存在但无法通过校验或读取尺寸。

尺寸字段可空仅表示 `invalid_image`，不引入第四种健康状态。历史迁移中的重复哈希作为诊断信息显示，不自动去重。元数据详情即使为 `missing_file` 或 `invalid_image` 也返回 `200` 并带健康状态；只有资产 ID 不存在或实际 `/uploads/...` 字节请求不存在才返回 `404`。

## 7. 媒体 API

管理端接口统一为：

```text
POST   /api/admin/media
GET    /api/admin/media
GET    /api/admin/media/{id}
GET    /api/admin/media/{id}/usages
DELETE /api/admin/media/{id}
POST   /api/admin/media/{id}/restore
DELETE /api/admin/media/{id}/purge
```

### 7.1 上传响应

保留现有调用方需要的 `url`，并增加资产字段：

```json
{
  "id": 42,
  "url": "/uploads/2026/07/uuid.png",
  "storage_path": "2026/07/uuid.png",
  "original_name": "architecture.png",
  "mime_type": "image/png",
  "byte_size": 183240,
  "width": 1600,
  "height": 900,
  "source": "paste",
  "status": "active"
}
```

为避免一次性破坏现有前端，一个兼容版本内的图片响应同时提供以下别名：

```text
filename    = basename(storage_path)
mime        = mime_type
size        = byte_size
uploaded_at = created_at
kind        = "image"
```

`url` 始终是规范公共 URL。`POST /api/admin/media?kind=table` 作为 CSV 兼容路径暂由旧 `ArticleImage` 支撑，CSV 记录不进入图片 `MediaAsset`，也不出现在图片媒体库。保留 `POST /api/admin/media/generate`，但生成的图片必须通过统一上传服务登记为 `source=generated`。

### 7.2 列表

`GET /api/admin/media` 支持：

- `q`：对 `original_name OR storage_path` 做大小写不敏感、转义后的匹配，最长 100 字符；
- `source`：来源筛选；
- `usage`：`used` 或 `unused`，其中 `unused` 表示零条 `MediaUsage`；
- `status`：`active` 或 `trashed`，默认 `active`；回收站显式请求 `trashed`；
- `health`：健康状态；
- `page`、`per_page`：分页。

`source=legacy + usage=unused + status=active` 即界面中的“未使用/待认领”，不新增第三种生命周期状态。health 是派生值：应用普通数据库条件后，对 health 筛选所需候选项检查文件，再执行分页。当前约 247 个文件可接受该实现；若未来规模增长，再基于实测决定是否引入缓存。

响应遵循项目统一分页格式：

```json
{
  "items": [],
  "total": 0,
  "page": 1,
  "per_page": 24
}
```

### 7.3 错误契约

错误统一为：

```json
{
  "error": {
    "code": "asset_in_use",
    "message": "该图片仍被引用",
    "usages": [
      {"owner_type": "article", "owner_id": 19, "field": "content", "title": "…"}
    ]
  }
}
```

- `409 asset_in_use`：资产仍被引用，并返回 usage 列表；
- `422 invalid_image`：内容不是有效图片；
- `422 invalid_path`：媒体路径不安全或无法规范化；
- `422 invalid_kind`：上传 kind 不受支持；
- `422 unknown_media_asset`：正文引用本站路径但没有对应资产；
- `422 unavailable_media_asset`：对应资产已回收、缺失或无效；
- `422 upload_incomplete`：正文仍含未完成上传标记；
- `422 unassigned_journal`：发布文章没有有效所属期数；
- `413`：图片超过大小限制；
- `404`：资产 ID 不存在。

列表响应严格保持 `{items,total,page,per_page}`，不增加 `pages`。

## 8. Markdown 编辑器与媒体抽屉

### 8.1 单一插图服务

粘贴、拖放、工具栏上传和媒体库选择共用一个前端插入服务，输入是文件或已有 `MediaAsset`，输出是插入到指定编辑位置的标准 Markdown 图片。

```text
剪贴板粘贴 ─┐
拖放图片 ───┤
工具栏上传 ─┼─> MediaAsset -> URL -> 光标处插入 Markdown
媒体库选择 ─┘
```

通过传入经过过滤的 `commands` 数组移除 `@uiw/react-md-editor` 内置的 URL 图片命令。工具栏保留两个明确入口：现有“上传图片”和“媒体库”按钮；后者打开右侧抽屉。粘贴与拖放通过 textarea 事件触发，不增加工具栏按钮。验收时确认不再出现重复的内置图片按钮。四种路径都调用同一个基于 React 状态的插入服务。

### 8.2 粘贴图片

通过编辑器内部 textarea 的 `onPaste` 处理：

1. 检查剪贴板是否包含图片文件；
2. 如果没有图片文件，不拦截默认粘贴，普通文字和普通 URL 保持原样；
3. 保存当前选区，并通过 functional React state update 插入唯一标记 `<!--hbsc-upload:<uuid-v4>-->`；
4. 上传期间显示进度；前端禁用保存和两条发布路径；
5. 上传成功后，再通过 functional state update 在**最新正文**中将该唯一标记替换为 `![alt](url)`；
6. 上传失败时只移除自己的唯一标记，显示可重试错误；
7. 上传成功后资产立即出现在媒体库；文章保存后才建立正式 `MediaUsage`。

异步回调不得直接修改 `textarea.value`、派发 synthetic input，或用上传开始时捕获的整段 content 覆盖新状态。如果用户在上传完成前手动删除标记，回调不得改变其他文字；已上传资产保留为未使用。后端保存和两条发布路径都扫描 `<!--hbsc-upload:`；发现残留标记即返回 `422 upload_incomplete`，避免只依赖前端按钮禁用。

粘贴文件缺少有意义名称时可以先插入空 alt；界面提供非阻塞的“补充图片说明”入口，发布校验给出缺少 alt 的警告，但不作为硬性阻断。

### 8.3 拖放图片

通过 textarea 的 `onDrop` 处理。只拦截图片文件；非图片拖放保持默认行为。textarea 在不同浏览器中无法可靠地把像素落点转换为字符位置，因此不承诺精确插入到鼠标落点：优先使用事件发生时 textarea 的 `selectionStart`，其次使用最近保存的 textarea 选区，最后回退到正文末尾。其余上传、唯一标记、functional state update 和失败恢复逻辑与粘贴一致。

### 8.4 工具栏上传

保留现有上传按钮，但改为统一媒体 API 和统一插入服务。文件选择后允许填写图片说明；跳过时插入空 alt 并由发布前检查提示。

### 8.5 右侧媒体抽屉

编辑器右侧媒体抽屉支持：

- 搜索原始文件名；
- 按来源、使用状态和生命周期筛选；
- 上传新图片；
- 查看缩略图、尺寸、大小、上传人、时间和健康状态；
- 查看“被哪些文章/期刊使用”；
- 选择 active 且健康的资产；
- 输入当前文章中的 alt 后插入当前光标位置。

同一媒体库组件同时服务独立 `/admin/media` 页面和编辑器抽屉。抽屉的“选择模式”是纯前端组件模式，不增加专用 API，也不改变媒体列表响应。打开抽屉时，在焦点进入搜索框或 alt 输入前捕获并冻结 textarea 选区；插入时使用该保存选区，没有选区则回退到正文末尾。

选择模式只允许选择 active 且 healthy 的资产，隐藏回收和永久清理等危险操作，并通过 `onSelect(asset)` 返回普通媒体列表记录；调用方把当前输入的 alt 交给共享插入服务。独立页面模式提供完整生命周期操作。

### 8.6 Word 导入

DOCX 导入器提取图片后，使用统一媒体服务创建 `MediaAsset(source=docx)`，并在返回 Markdown 中生成标准图片语法。导入本身不创建文章 usage；文章保存时统一同步。

导入后未保存或取消编辑的图片在媒体库中显示为“未使用”，不会自动永久删除，可由管理员批量移入回收站。

修复现有自动排版调用读取旧 React 状态的问题：自动排版必须显式接收刚导入的 Markdown，而不能依赖尚未更新完成的表单闭包状态。

### 8.7 预览一致性

后台预览与公开文章详情页继续共用现有 `ArticleBody`，不新增第二套渲染器。共享组件统一承担：

- GFM；
- 图片 URL 解析；
- `loading="lazy"`；
- 图片样式；
- 表格包裹；
- 外部链接安全属性。

现有 `media/...` 兼容解析仅为尚未迁移的旧文章保留；所有新插入内容必须使用 `/uploads/{storage_path}`。不启用 raw HTML。增加后台预览与公开详情渲染一致性测试，并覆盖规范 `/uploads/...` 与旧 `media/...` 两类输入。

## 9. 指定文章定向修复

对文章 `id=19` 执行 fail-closed 定向转换：

1. 迁移通用 uploads 扫描先按 `storage_path` 幂等确保四个 `MediaAsset(source=legacy)` 存在；文章专用转换不得重复插入资产；
2. 转换前必须找到恰好四组相邻行：
   - 标题行匹配 `^图([1-4])\s+(.+)$`；
   - 下一行严格匹配 `^（图像路径：/uploads/source-images/19-hongan-medical/image\1\.png）$`；
   - 编号 1、2、3、4 必须各出现一次；
3. 任一数量、顺序、相邻关系、路径或文件健康状态不满足时整体中止，不写文章；
4. 将每个占位行替换为：

   ```md
   ![<完整前一行图题>](/uploads/source-images/19-hongan-medical/imageN.png)
   ```

5. 原正文保存为 `<report-dir>/article-19-before.md`，SHA-256 保存为 `<report-dir>/article-19-before.sha256`；
6. 保存文章并同步正文 usage；
7. 成功条件为：四个 Markdown image token、零个匹配占位行、除四个占位行外内容不变、四条正文 usage；
8. 验证后台预览和公开页面均显示四张图；
9. 不修改标题、slug、分类、封面或期数。

不得在前端加入“遇到图像路径文字就猜成图片”的通用补丁。迁移报告列出其他文章中的类似占位符，由管理员通过现有文章编辑器逐篇审核，未经确认不自动改写。

## 10. `/admin/articles` 按期数管理

### 10.1 页面布局

顶部期数切换：

```text
全部文章 19 | 2026年第二期 8 | 2026年第一期 11 | 未归期 0
```

下面保留关键词、分类、状态、精选和排序筛选，以及服务端分页文章表格。

### 10.2 权威字段与显示规则

- `Article.journal_id` 是期数归属的唯一权威字段；
- `Journal.title` 用于显示，例如“2026年第二期”；
- `Journal.issue_number` 是编号/排序元数据，不用于建立关系；
- `journal_id IS NULL` 进入“未归期”；
- 期数按出版时间倒序；
- 标签计数包含该期草稿和已发布文章；
- “全部文章”显示所属期数列；具体期数视图可隐藏该列；
- 未归期行显示醒目标记。

### 10.3 后端筛选契约

管理端文章列表增加：

- `journal_id=<int>`：具体期数；
- `unassigned=true`：未归期；
- `search`、`category`、`status`、`featured`、排序、`page`、`per_page`：与期数组合。

`journal_id` 与 `unassigned=true` 同时出现时返回 `422`。后端使用 `status_filter: Optional[str] = Query(None, alias="status")`，对外统一 query 名称为 `status`，并增加 `?status=draft` 契约测试，避免 Python 参数名与现有字段/符号冲突。

期数标签计数使用管理端期刊列表中的 `article_count`；“全部文章”使用默认文章列表 `total`；未归期使用 `unassigned=true` 查询的 `total`。计数和文章查询均包含草稿，符合后台管理语义。

筛选状态写入 URL 查询参数；切换期数或改变筛选时重置页码为 1。不得在浏览器加载全部文章后再分组。

### 10.4 编辑器归期

文章表单增加“所属期数”选择器：

- 从期刊详情页创建时按 query 参数预选；
- 从全局文章页创建时可选择期数或暂存未归期草稿；
- 编辑已有文章时由管理端详情 API 返回并回填真实 `journal_id`；
- 允许重新归期；
- 任一非空 `journal_id` 必须指向真实存在的期刊；
- 草稿允许 `journal_id=NULL`；
- 发布校验集中在一个服务函数中，`PUT /api/admin/articles/{id}` 把 status 改为 published 和专用发布端点都必须在设置 `published_at` 前调用；
- 任一发布路径没有有效期数时返回 `422 {code:"unassigned_journal"}`；
- 保存或重新归期后刷新文章列表与期数计数。

### 10.5 与期刊详情页的职责

- `/admin/articles`：跨期全局检索、筛选、归期和管理；
- `/admin/journals/:id`：单期内按四个固定栏目检查内容和发布完整性。

两处使用相同的 `journal_id` 和文章 API，不重复实现隐式期数推断。

## 11. 历史迁移与回滚

项目当前没有 Alembic。新表由 SQLAlchemy metadata 定义，建表与数据回填由独立、可重复执行的迁移命令控制；不得把历史数据改写隐藏在普通应用启动中。

### 11.1 环境诊断与可验证备份

应用和迁移命令启动时只解析一次绝对数据库路径与 uploads 根目录，两者均锚定到 backend 应用目录并写入日志。首先运行：

```bash
python -m app.scripts.migrate_media doctor
```

`doctor` 输出 hostname、CWD、脱敏后的已解析数据库位置、绝对 uploads 根、文章数、普通文件数和总字节数；路径不存在、uploads containment 校验失败或数据库不可读时非零退出。生产 apply 前进入维护模式并排空写请求。

备份要求：

1. 使用 SQLite `.backup` 生成一致性数据库备份，不直接复制正在写入的 SQLite 文件；
2. 把 uploads 归档到应用数据卷之外的绝对备份目录；
3. 为数据库备份和 uploads 归档生成 SHA-256 manifest；
4. 对数据库备份执行 `PRAGMA integrity_check`；
5. 验证 uploads 归档可列出；
6. 把备份绝对路径、哈希和验证结果写入迁移审计。

### 11.2 `plan` 与 `apply` 硬边界

迁移只提供两个互斥命令：

```bash
python -m app.scripts.migrate_media plan \
  --report-dir <absolute-dir>

python -m app.scripts.migrate_media apply \
  --plan <plan.json> \
  --confirm-sha256 <plan-sha256>
```

`plan`：

- 不写数据库；
- 不在 uploads 下写文件；
- 不移动、重命名或删除文件；
- 唯一可写位置是显式指定的绝对 report 目录；
- 记录数据库行数指纹，以及 uploads 路径、大小和 SHA-256 指纹。

`apply`：

- 必须处于维护模式并持有独占进程锁；
- 必须提供已审核 `plan.json` 的准确 SHA-256；
- 任一数据库/uploads 指纹变化即中止，要求重新生成 plan；
- 使用 `BEGIN IMMEDIATE` 完成数据库建表、资产/usage upsert 和文章 19 定向修改；
- 重复执行保持幂等；
- 不使用交互式“输入 GO”提示；
- 不提供任何物理删除模式。

### 11.3 盘点、映射与 upsert 规则

uploads 下每个路径必须成为已登记资产，或出现在 skipped/error 报告中：

1. 递归扫描普通文件，`.gitkeep` 作为已知控制文件忽略；
2. symlink、其他隐藏/控制文件、零字节文件、不支持 MIME 和无法解码图片只报告，不跟随、不登记；
3. `storage_path` 使用文件系统原始 POSIX 相对路径，不重命名、不做 Unicode normalization；
4. 拒绝绝对路径、反斜杠、空段、`.`、`..` 或解析后越出 uploads 根的路径；
5. 新的有效图片从实际字节计算 MIME、大小、尺寸和 SHA-256，写入 `source=legacy`、迁移时间 `created_at`，并以顶级目录写入简短 `source_ref`；
6. `storage_path` 冲突时复用现有 `MediaAsset`，不覆盖元数据；若字节/哈希漂移则报告；
7. `MediaUsage` 唯一键冲突时复用记录，并把 `reference_count` 更新为本次解析结果；
8. 旧 `ArticleImage` 候选路径严格按 `{uploaded_at:%Y/%m}/{filename}` 构造；只有该扫描文件确实存在时，才把 `original_name`、`uploaded_by` 和原 `uploaded_at` 带入资产；MIME、大小、尺寸和哈希仍以实际字节为准，差异写入报告；
9. 无法映射的旧记录继续保留在 `article_images` 并报告，不猜测路径、不虚构 schema 字段；
10. 非图片/CSV 旧记录只保留在 `article_images`，不进入 `MediaAsset`；
11. 解析全部文章 Markdown、`Article.cover_image` 和 `Journal.cover_image`，为可匹配本站资产的引用创建 usage；
12. migration 遇到未知、trashed、missing_file 或 invalid_image 的本地引用只报告，不自动重写；
13. “未使用/待认领”严格由 `source=legacy + status=active + 零 usages` 派生，不写第三种状态；
14. 只对文章 19 执行第 9 节定义的 fail-closed 自动改写；其他占位符只进入报告并由管理员人工审核；
15. 旧 `article_images` 表保留，暂不删除。

### 11.4 报告与审计产物

`plan` 固定生成：

- `plan.json`：apply 的不可变输入；
- `report.md`：人工审核报告；
- `manifest.sha256`：计划文件及源指纹哈希。

`apply` 追加写入 `apply-audit.jsonl`。报告和审计至少包括：

- run ID、开始/结束时间和 doctor 输出；
- 计划创建、复用、更新的资产/usage 数量；
- 每个路径和哈希；
- 无法映射的 `ArticleImage`；
- 未知本地 URL、缺失/无效/跳过文件；
- 重复哈希分组；
- `degraded_markdown_placeholders`：文章 ID/slug、占位符原文、附近行、候选路径和文件/资产健康状态；
- apply 创建的资产/usage ID；
- apply 后资产 manifest；
- 文章 19 的修改前正文与 SHA-256。

迁移只登记现有文件，不移动、不重命名、不自动删除。

### 11.5 回滚

1. 重新进入维护模式并排空写请求；
2. 保存 `apply-audit.jsonl` 和 apply 后 manifest；
3. 恢复经验证的迁移前数据库备份；
4. 回滚应用代码；
5. 对比迁移前和 apply 后 manifests，列出 apply 后创建的文件；
6. 默认保留这些文件，不盲目删除，交给后续对账/导入流程；
7. 验证旧 URL 与核心文章后再退出维护模式。

## 12. 验证与测试

### 12.1 后端自动化测试

- `markdown-it-py` AST 仅提取 image token，不把普通链接或“图像路径”文字当图片；
- `/uploads/...` percent-decode、query/fragment、containment 与 legacy `media/...` 映射符合第 5.3 节；
- 未知、trashed、缺失或无效的本站资产使交互式保存整体回滚；
- 正文重复引用正确更新 `reference_count`；
- 新增、移除和替换正文图片正确同步 usage；
- 文章/期刊封面正确同步 usage，替换时不硬删除旧资产；
- 删除文章/期刊显式清理多态 owner usages，但不删除资产；
- 外部图片不建立本站 usage；
- 被引用媒体删除返回 `409 asset_in_use` 和引用详情；
- 未引用媒体可回收、恢复，重新回收会重置保留期；
- purge 在 `BEGIN IMMEDIATE` 中重查状态、保留期和 usage，并覆盖 unlink/DB 失败的可对账状态；
- 扩展名为 `.png` 的伪图片被拒绝，真实格式决定 MIME 和后缀；
- 所有文件路径穿越被拒绝；
- 上传数据库失败时执行补偿清理并记录清理失败；
- `plan` 除报告目录外不写数据、不移动文件；
- `apply` 拒绝变化后的源指纹或错误 plan 哈希，并可幂等重跑；
- 每个 uploads 路径都出现在资产或 skipped/error 报告中；
- 旧 `ArticleImage` 只按 `{uploaded_at:%Y/%m}/{filename}` 精确映射；
- 指定文章转换条件不满足时零写入；成功时恰好四个 image token、零占位行、四条 usage，其他正文不变；
- 两条文章发布路径都拒绝未归期或无效 journal；草稿可以未归期；
- `?status=draft` 契约及管理端文章列表的期数、搜索、分类、状态和分页组合正确；
- 媒体兼容别名和 `{items,total,page,per_page}` 响应形状正确。

### 12.2 前端与端到端验证

- 在编辑器中粘贴 PNG，上传完成后只替换自己的 `<!--hbsc-upload:...-->` 标记，并保留上传期间产生的其他编辑；
- 用户提前删除标记时异步回调不改动其他文字，资产成为未使用；
- 前端禁止、后端拒绝把残留临时标记保存或发布到数据库；
- 拖放按 textarea 当前/最近选区插入，无法取得选区时回退到正文末尾；
- 工具栏只保留上传和媒体库两个图片相关按钮，不出现重复内置 URL 图片按钮；
- 拖放、工具栏上传和媒体选择复用相同 state-based 插入服务；
- 打开媒体抽屉后冻结原 textarea 选区，搜索或输入 alt 后仍插入到该选区；
- 媒体抽屉可以搜索、筛选、上传和选择；
- 保存文章后，资产详情显示该文章正文引用；
- 删除被引用图片时显示使用位置且文件保持可访问；
- 回收并恢复未引用图片后 URL 不变；
- 后台预览与公开详情页渲染一致；
- 指定文章公开页面显示全部四张图；
- 顶部期数切换、组合筛选、分页和 URL 状态正确；
- 修改所属期数后，旧期和新期计数及列表均刷新；
- 全局编辑已有文章时正确回填 `journal_id`。

### 12.3 成功标准

本项目完成必须同时满足：

1. 指定文章显示四张正确图片，不改动其他正文；
2. 直接粘贴、拖放或上传图片后，图片立即可在媒体库找到；
3. 保存文章后，媒体库能显示该图片的准确使用位置；
4. 被引用图片无法删除，未引用图片可回收并恢复；
5. 现有媒体完成全量盘点，迁移不移动或自动删除历史文件；
6. `/admin/articles` 可以按全部、每一期和未归期切换，并与现有筛选/分页组合；
7. 文章编辑器可以显示和修改所属期数，未归期文章不能发布；
8. 后台预览与公开页面使用同一渲染规则；
9. 相关自动化测试、前端构建和端到端验证全部通过。

## 13. 建议实施顺序

1. 建立媒体模型、路径规范化、引用提取和测试；
2. 实现新媒体 API、引用保护和回收站；
3. 实现 `doctor`、不可变 `plan`、幂等 `apply`、备份/审计与历史盘点；
4. 定向修复文章 19；
5. 打通编辑器粘贴、拖放、工具栏和媒体抽屉；
6. 核对并测试现有共享 `ArticleBody` 渲染组件；
7. 增加后台文章期数筛选和编辑器归期；
8. 执行全量自动化测试、生产构建和浏览器端到端验证；
9. 生产维护模式下完成 `doctor`、一致性备份、plan 审核和哈希绑定的 apply。
