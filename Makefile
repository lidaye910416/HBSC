.PHONY: help build package package-backend deploy deploy-list deploy-stop rebuild clean verify-frontend

# ── 部署服务（通过 deploy-service skill）────────────────────────────────────
# 这个 Makefile 防止源码/dist 漂移：每次 deploy 前会自动 rebuild 前端 dist/
# 并重新打包后端 tar.gz。
#
# 用法：
#   make deploy          # 全流程：build 前端 → 打包后端 → deploy 到远端
#   make deploy-list     # 只查看远端当前部署状态
#   make deploy-stop     # 只停止远端服务
#   make verify-frontend # 检查 src → dist 是否同步（无 build 也能跑）
#   make clean           # 删除本地构建产物

# 配置变量
BACKEND_DIR  := backend
FRONTEND_DIR := frontend-vite
DIST_DIR     := $(FRONTEND_DIR)/dist
PACKAGE_FILE := /tmp/hbsc-api.tar.gz
DEPLOY_YAML  := deploy.yaml
DEPLOY_SCRIPT := $(HOME)/.claude/skills/deploy-service/scripts/deploy.py

help: ## 显示所有可用命令
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ── 构建步骤 ──────────────────────────────────────────────────────────────

build: build-frontend package-backend ## 构建前端 + 打包后端

build-frontend: ## 构建前端 dist/
	@echo "==> [1/2] 构建前端 dist/"
	@cd $(FRONTEND_DIR) && npm run build

package-backend: ## 打包后端源码 tar.gz（排除 data/ research.db uploads/*）
	@echo "==> [2/2] 打包后端 $(PACKAGE_FILE)"
	@cd $(BACKEND_DIR) && tar --exclude='__pycache__' --exclude='*.pyc' --exclude='.pytest_cache' --exclude='*.db-journal' --exclude='.env' --exclude='./data' --exclude='./research.db' --exclude='./uploads/*' -czf $(PACKAGE_FILE) .

# ── 部署步骤 ──────────────────────────────────────────────────────────────

deploy: build ## 完整部署流程：build + 包 + 上传到远端
	@echo "==> 部署到远端服务器（deploy.yaml 配置）"
	@python3 $(DEPLOY_SCRIPT) deploy $(DEPLOY_YAML)
	@echo ""
	@echo "==> 覆盖 nginx.conf 加入 /api/ 反代（deploy-service 不会自动生成）"
	@scp deploy/nginx-hbsc.conf root@$$(grep '^  host:' $(DEPLOY_YAML) | awk '{print $$2}'):/opt/apps/nginx/conf/nginx.conf
	@ssh root@$$(grep '^  host:' $(DEPLOY_YAML) | awk '{print $$2}') 'docker restart app-nginx-hbsc'

deploy-list: ## 查看远端所有用户的部署状态
	@python3 $(DEPLOY_SCRIPT) list $(DEPLOY_YAML)

deploy-stop: ## 停止远端服务（按 deploy.yaml 定义）
	@python3 $(DEPLOY_SCRIPT) stop $(DEPLOY_YAML)

# ── 健康检查 / 漂移检测 ───────────────────────────────────────────────────

verify-frontend: ## 验证 src 改动是否已 build 到 dist（防止再发生源/包漂移）
	@echo "==> 检查最近修改的 src 文件是否都已 build 到 dist..."
	@if [ ! -d "$(DIST_DIR)" ]; then \
		echo "❌ $(DIST_DIR) 不存在，请先 make build-frontend"; exit 1; \
	fi
	@latest_src=$$(find $(FRONTEND_DIR)/src -type f \( -name "*.tsx" -o -name "*.ts" -o -name "*.css" \) -exec stat -f "%m %N" {} \; | sort -rn | head -1 | awk '{print $$1}'); \
	latest_dist=$$(find $(DIST_DIR) -type f -exec stat -f "%m %N" {} \; | sort -rn | head -1 | awk '{print $$1}'); \
	if [ "$$latest_src" -gt "$$latest_dist" ]; then \
		echo "❌ src 比 dist 新（src: $$(date -r $$latest_src), dist: $$(date -r $$latest_dist)）"; \
		echo "   请先运行: make build-frontend"; \
		exit 1; \
	else \
		echo "✅ src/dist 同步（最新 dist: $$(date -r $$latest_dist)）"; \
	fi

# ── 清理 ──────────────────────────────────────────────────────────────────

clean: ## 清理本地构建产物
	@echo "==> 删除 $(DIST_DIR) 和 $(PACKAGE_FILE)"
	@rm -rf $(DIST_DIR)
	@rm -f $(PACKAGE_FILE)