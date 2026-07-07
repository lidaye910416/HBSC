# 湖北数创 部署文档（DEPLOY）

> 适用版本：v1.0
> 文档日期：2026-07-06
> 适用人群：运维 / 后端 / 平台管理员

本文档说明如何把 `release/` 目录中的产物部署到目标环境，覆盖三种典型场景：

- **场景 A**：本地 / 测试机 `docker compose` 一键启动
- **场景 B**：内网 Agent 技能管理平台（`/deploy-service` 技能）部署
- **场景 C**（可选）：远端镜像仓库推送

> 引用：[Agent 技能管理平台使用文档] — `/deploy-service` 技能用法见该文档第 4 章。

---

## 1. 发布物清单

`release/` 目录包含以下文件：

| 文件 | 大小 | 作用 |
| --- | --- | --- |
| `docker-compose.yml` | 1.3 KB | 生产环境 compose 定义（backend / frontend / nginx），使用预构建镜像 `hbsc-backend:latest` 与 `hbsc-frontend:latest` |
| `nginx.prod.conf` | 1.1 KB | Nginx 反向代理配置（80 端口对外，路由 `/api/`、`/uploads/` 到 backend，其余到 frontend） |
| `.env.example` | 0.8 KB | 环境变量模板（管理员密码哈希、JWT 密钥、上传大小限制、AI 图像生成 token） |
| `hbsc-backend.tar` | 约 494 MB | 后端 docker 镜像包（v1.6，FastAPI + SQLAlchemy + SQLite + 烤入的 uploads 种子数据） |
| `hbsc-frontend.tar` | 约 80 MB | 前端 docker 镜像包（v1.6，React + Vite 静态构建，nginx 同时反代 `/api/` 和 `/uploads/`） |

> 注：实际文件大小以 release/ 目录下 `ls -lh` 输出为准。
>
> `nginx.prod.conf` 在执行 `docker compose up` 时由 `docker-compose.yml` 挂载进 nginx 容器，因此发布物中只保留一份本地副本即可。

### 1.1 v1.1 修复说明（相对初始打包）

打包过程中在后端镜像里发现两个会让容器 crash-loop 的 bug，已就地修复并重新导出 tar：

| # | 文件 | 症状 | 修复 |
| - | ---- | ---- | ---- |
| 1 | `app/routers/public_agent_router.py` | 容器启动报 `PydanticUndefinedAnnotation: name 'ExecuteRequest' is not defined` | 移除文件头部的 `from __future__ import annotations`（与 Pydantic 2.7.1 的 PEP-563 forward-ref 解析冲突） |
| 2 | `app/routers/admin_articles_typeset.py` | 同上，针对 `TypesetRequest` / `TypesetResponse` | 同样移除 `from __future__ import annotations` |
| 3 | `app/config.py` | 当 `ADMIN_PASSWORD_HASH` 为空时，dev 默认密码生成触发 `config ↔ security` 循环导入（`ImportError: cannot import name 'settings' from partially initialized module`） | 把对 `hash_password` 的导入改为文件顶部内联 `bcrypt`，打破循环 |
| 4 | `app/middleware/rate_limit.py` | `/api/public/agent/execute` 调用报 `ValueError: 'coroutine' object is not iterable`（FastAPI serialize_response 拿到的是未 await 的 coroutine） | 装饰器 wrapper 从 `def` 改为 `async def`，`return func(...)` 改为 `return await func(...)`。影响 3 个端点（`/execute`、`/llm`、`/typeset`） |
| 5 | `backend/Dockerfile` + `.dockerignore` + Docker 卷自动初始化 | 部署后所有 `/uploads/article-covers/*.jpg` 封面图 404 — 命名卷 `backend_uploads` 在首次部署时是空的，但 DB 种子数据引用了这些图片 | 从 `.dockerignore` 移除 `uploads/`，让 `COPY . .` 把 uploads 烤进镜像到 `/app/uploads/`；Docker 在新建命名卷时会自动把镜像的 `/app/uploads/` 拷贝进卷（一次性），已存在的卷不被覆盖（用户上传不丢）。无需 entrypoint 脚本，Docker 原生行为已足够。 |
| 6 | `app/main.py` CORS 配置 | SPA origin 不在 `ALLOWED_ORIGINS` 列表里（如 `localhost:8080`、`192.168.x.x`），导致跨域部署时浏览器拦截 `/api/articles` 响应 → React 拿不到 cover_image → CoverImage 触发 onError → 渲染占位色块（用户看到的"图片不显示"） | 在 `CORSMiddleware` 上加 `allow_origin_regex=r"^https?://(localhost\|127\.0\.0\.1\|192\.168\.\d+\.\d+\|10\.\d+\.\d+\.\d+)(:\d+)?$"`，覆盖本地所有内网 IP 段，无需手动配 ALLOWED_ORIGINS |
| 7 | `frontend-vite/nginx.conf` | 镜像内嵌 nginx 只反代 `/api/`，**不反代 `/uploads/`**，导致从 frontend 入口（端口 18081）访问封面图时返回 404 | 在 nginx.conf 加 `location /uploads/ { proxy_pass http://backend:8000; }`，问题在构建时一次性修复，无需外层 nginx |

附加变更：

- 新增 `backend/.dockerignore`：排除 `.env`、`research.db`、`uploads/`、`tests/`、`.pytest_cache/` 等敏感/无用文件（之前会随 `COPY . .` 一起进镜像，存在 .env 泄露风险）
- 后端镜像体积 535 MB → 481 MB（剔除上述文件后）

验证记录（在打包机器上 `docker compose -f docker-compose.prod.yml up -d` 实测）：

```text
NAME                         STATUS         PORTS
hubei-shuchuang-backend-1    Up 8 seconds   8000/tcp
hubei-shuchuang-frontend-1   Up 8 seconds   80/tcp
hubei-shuchuang-nginx-1      Up 8 seconds   0.0.0.0:80->80/tcp

frontend=200 api=200
[SECURITY][DEV ONLY] Using ephemeral admin credentials — username='admin' password='dev-...'
✅ 湖北数创种子数据初始化完成 (期刊:2, 文章:12, 研究人员:2)
```

---

## 2. 场景 A：本地 docker compose 一键启动

适用：开发机自测、单机测试、临时演示。

### 2.1 前置条件

```bash
# 1. Docker Engine >= 20.10
docker --version

# 2. Docker Compose v2（已内嵌在 docker CLI 中）
docker compose version

# 3. 主机 80 端口空闲（nginx 对外）
lsof -i :80
```

### 2.2 加载镜像

```bash
cd release/

docker load -i hbsc-backend.tar
docker load -i hbsc-frontend.tar

# 确认镜像已加载
docker images | grep hbsc-
# 应输出：
# hbsc-backend   latest   <IMAGE_ID>   ...
# hbsc-frontend  latest   <IMAGE_ID>   ...
```

### 2.3 配置环境变量

```bash
# 复制并填写 .env
cp .env.example .env
vim .env
```

关键字段：

| 变量 | 说明 |
| --- | --- |
| `ADMIN_USERNAME` | 后台管理员用户名 |
| `ADMIN_PASSWORD_HASH` | 管理员密码的 bcrypt 哈希（`python3 -m scripts.create_admin <username> <password>` 生成） |
| `JWT_SECRET` | JWT 签名密钥，**生产环境必须修改**（`openssl rand -hex 32`） |
| `MINIMAX_TOKEN` | AI 图像生成 token，留空则使用 PIL 占位图 |

### 2.4 启动

```bash
# 在 release/ 目录下执行
docker compose up -d

# 查看运行状态
docker compose ps
```

预期输出：三个服务 `backend`、`frontend`、`nginx` 均为 `running` / `healthy`。

### 2.5 验证

```bash
# 1. 后端健康检查
curl -fsS http://localhost/api/articles | head -c 200
# 期望：返回 JSON（文章列表）

# 2. 前端首页
curl -fsSI http://localhost/
# 期望：HTTP/1.1 200 OK，Content-Type: text/html

# 3. 浏览器访问
open http://localhost/        # macOS
xdg-open http://localhost/    # Linux
```

### 2.6 关闭

```bash
# 停止并保留数据卷（uploads/）
docker compose down

# 停止并清理数据卷（会删除上传文件，不可恢复）
docker compose down -v
```

---

## 3. 场景 B：内网 Agent 技能管理平台部署

适用：公司内网服务器（小龟山机房），通过 Workbuddy / 智能体 CLI 的 `/deploy-service` 技能部署。

> 平台地址：<http://192.168.15.204:8001/>
> 详细用法参见 [Agent 技能管理平台使用文档]。

### 3.1 准备工作

1. **后端必须 docker 化**

   文档原话：[Agent 技能管理平台使用文档] §4：「后端应用开发时，建议要求 workbuddy 使用 docker 来创建后端服务，便于进行制品上传和管理。」

   本发布物后端已经 docker 化（`hbsc-backend.tar`），无需额外处理。

2. **权限限制**

   文档原话：[Agent 技能管理平台使用文档] §4：「该技能以用户名和机器 id 为限制，仅支持个人相关服务的控制。为避免服务冲突，可以查看服务器上其他人发布的服务，但不允许控制其他人的服务。」

   - 同一台机器上只能用**自己的账号** deploy
   - 可以 `list` 看其他人的服务，但**不能** start/stop

3. **准备 tar 包**

   ```bash
   # 确认文件存在
   ls -lh release/hbsc-backend.tar release/hbsc-frontend.tar
   ```

### 3.2 部署后端（`/deploy-service deploy`）

在 Workbuddy / 智能体 CLI 中输入：

```
/deploy-service deploy hbsc-backend
```

按提示：

1. 选择 "上传制品"
2. 拖入 `release/hbsc-backend.tar`
3. 等待上传、加载、启动完成

CLI 输出示例：

```
[INFO] 正在加载镜像 hbsc-backend.tar ... OK
[INFO] 创建容器 hbsc-backend-<user> ... OK
[INFO] 端口映射 8000 -> 18000 ... OK
[INFO] 服务已启动
```

### 3.3 部署前端（`/deploy-service deploy`）

```
/deploy-service deploy hbsc-frontend
```

同样上传 `release/hbsc-frontend.tar`。

### 3.4 四条子指令速查

| 子指令 | 用途 | 备注 |
| --- | --- | --- |
| `deploy [服务名称]` | 上传并部署服务 | 上传 tar 镜像包，平台自动 `docker load` + `docker run` |
| `list` | 查看已部署服务 | 列出当前账号下、或本机所有服务（只读） |
| `start [服务名称]` | 启动已停止的服务 | 适用于临时停机后重启 |
| `stop [服务名称]` | 停止服务 | 容器被 stop，数据卷保留 |

> 数据来源：[Agent 技能管理平台使用文档] §4 表格。

### 3.5 部署后验证

```bash
# 在浏览器打开平台分配的访问地址，例如：
http://<内网IP>:<分配端口>/
```

或通过 curl 探活：

```bash
curl -fsS http://<内网IP>:<分配端口>/api/articles | head -c 200
```

### 3.6 注意事项

- **用户名 + 机器 ID 限制**：换机器或换账号无法控制已有服务
- **后端 docker 化**：本发布物已满足；后续若修改后端代码，需重新 `docker save` 打包上传
- **环境变量**：平台部署模式下，`.env` 文件需在镜像构建时**烘焙**进去（当前 `hbsc-backend.tar` 使用默认 `SECRET_KEY=change-me...`，**生产环境必须重新构建带自定义 `JWT_SECRET` 的镜像**）
- **数据卷**：上传的 `uploads/` 内容位于容器内 `/app/uploads`，平台管理的命名卷会持久化，stop 不丢数据

---

## 4. 场景 C：远端镜像仓库推送（可选）

适用：需要把镜像推送到公司 Harbor / 阿里云 ACR / Docker Hub 等远端仓库，再由 K8s / 容器平台拉取。

### 4.1 登录

```bash
docker login <registry>   # 例如 registry.hbsc.local
```

### 4.2 标记镜像

```bash
REGISTRY=registry.hbsc.local/library   # 替换为实际仓库地址
VERSION=1.0

docker tag hbsc-backend:latest  ${REGISTRY}/hbsc-backend:${VERSION}
docker tag hbsc-frontend:latest ${REGISTRY}/hbsc-frontend:${VERSION}
```

### 4.3 推送

```bash
docker push ${REGISTRY}/hbsc-backend:${VERSION}
docker push ${REGISTRY}/hbsc-frontend:${VERSION}
```

### 4.4 在远端环境拉取

```bash
docker pull ${REGISTRY}/hbsc-backend:${VERSION}
docker pull ${REGISTRY}/hbsc-frontend:${VERSION}
```

之后按场景 A 的 `docker compose up -d` 流程启动（`docker-compose.yml` 不变）。

---

## 5. 回滚方案

### 5.1 保留上一版本 tar 文件

发布前**不要删除**上一版的 `hbsc-backend.tar` / `hbsc-frontend.tar`。建议按版本归档：

```
release/
├── 1.0/
│   ├── hbsc-backend.tar
│   ├── hbsc-frontend.tar
│   ├── docker-compose.yml
│   └── nginx.prod.conf
└── 0.9/
    ├── hbsc-backend.tar
    ├── hbsc-frontend.tar
    ├── docker-compose.yml
    └── nginx.prod.conf
```

### 5.2 回滚步骤

```bash
cd release/0.9/

docker load -i hbsc-backend.tar
docker load -i hbsc-frontend.tar

# 停掉当前版本
docker compose -p hbsc down   # -p <project_name> 对应原部署

# 启动旧版本
docker compose -p hbsc up -d
```

### 5.3 内网平台回滚

在 Workbuddy 中：

```
/deploy-service stop hbsc-backend
/deploy-service stop hbsc-frontend
```

然后重新 `/deploy-service deploy hbsc-backend` 并上传 0.9 版本的 tar 包。

> 提示：平台不保留历史版本镜像，**回滚的 tar 包必须本地留存**。

---

## 6. 常见问题

### 6.1 数据库迁移

后端使用 SQLite（`research.db`），**首次启动自动建表 + 写入种子数据**（9 篇文章、8 条资讯、3 个案例等）。如果需要清空数据重建：

```bash
docker compose down
docker volume rm release_backend_uploads  # 注意：会同时清空 uploads
# 重新启动即可
docker compose up -d
```

升级时数据库结构变更：Alembic 迁移文件位于 `backend/alembic/versions/`，容器启动时自动执行 `alembic upgrade head`。**不要手工改 `research.db` 表结构**。

### 6.2 .env 配置不生效

`docker-compose.yml` 默认从宿主机当前目录读取 `.env`。请确认：

1. `.env` 文件在执行 `docker compose up` 的目录下
2. 变量名与 `.env.example` 完全一致（区分大小写）
3. 修改 `.env` 后必须重启：

   ```bash
   docker compose up -d --force-recreate
   ```

### 6.3 端口冲突

报错示例：`bind: address already in use :::80`

排查：

```bash
# 找出占用 80 端口的进程
sudo lsof -i :80

# 方案 A：杀掉占用进程
sudo kill <PID>

# 方案 B：修改 docker-compose.yml 中 nginx 的端口映射
#   ports:
#     - "8080:80"   # 改 8080 对外
```

其他可能冲突端口：`8000`（后端直连）、`5173`（前端 dev）、`5432`（若改用 Postgres）。

### 6.4 镜像加载失败

报错示例：`open ...hbsc-backend.tar: no such file or directory`

排查：

```bash
# 确认当前路径
pwd
# 确认文件存在
ls -lh hbsc-backend.tar

# 若在 release/ 目录外：
docker load -i /Users/jasonlee/hubei-shuchuang/release/hbsc-backend.tar
```

### 6.5 JWT 密钥仍是默认值

报错示例：登录时返回 500，或提示「SECRET_KEY not configured」。

`SECRET_KEY` 必须修改：

```bash
openssl rand -hex 32
# 把输出粘贴到 .env 的 SECRET_KEY=...
docker compose up -d --force-recreate
```

### 6.6 上传文件 413 / 大小限制

Nginx 默认 `client_max_body_size 64m`。若上传更大文件，编辑 `nginx.prod.conf`：

```nginx
client_max_body_size 100m;   # 改为你需要的大小
```

并重启 nginx 容器：

```bash
docker compose restart nginx
```

---

## 附录 A：参考文档

- [Agent 技能管理平台使用文档] — `/deploy-service` 技能详细用法（部署平台：<http://192.168.15.204:8001/>）

## 附录 B：版本

| 字段 | 值 |
| --- | --- |
| 文档版本 | 1.0 |
| 适用 release | 2026-07-06 |
| 后端镜像 | hbsc-backend:latest |
| 前端镜像 | hbsc-frontend:latest |
