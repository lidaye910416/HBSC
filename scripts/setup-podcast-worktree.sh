#!/usr/bin/env bash
# =============================================================================
# setup-podcast-worktree.sh
#
# 数创智伴 「播一下」 tab 的 worktree + commit 引导脚本.
#
# Codex 沙箱禁止写 .git/(refs/heads/、worktrees/、index.lock),所以所有 git
# 写操作必须在沙箱外执行。本脚本:
#   1. 暂存当前未提交改动(包括本次会话新增/修改的文件);
#   2. 创建 worktree feat/fab-podcast 基于最新 main;
#   3. 在新 worktree 内 apply stash;
#   4. 拆成几个独立 commit(后端、前端、e2e、docs),便于 review。
#
# 用法:
#   cd /Users/jasonlee/hubei-shuchuang
#   bash scripts/setup-podcast-worktree.sh
#
# 退出码: 0=成功; 1=worktree 已存在 / stash 冲突; 2=git 不可写。
# =============================================================================
set -euo pipefail

REPO=/Users/jasonlee/hubei-shuchuang
BRANCH=feat/fab-podcast
WT_DIR="$REPO/.worktrees/feat-fab-podcast"

cd "$REPO"

# --- 1. 前置检查 ---
if [[ -d "$WT_DIR" ]]; then
  echo "❌ Worktree 已存在: $WT_DIR" >&2
  echo "   先 cd 进入并处理,或者删除: git worktree remove --force $WT_DIR" >&2
  exit 1
fi

if ! git rev-parse --verify main >/dev/null 2>&1; then
  echo "❌ 找不到 main 分支" >&2
  exit 2
fi

if ! touch .git/test-write 2>/dev/null; then
  echo "❌ .git/ 不可写;请在 Codex 沙箱外执行本脚本" >&2
  exit 2
fi
rm -f .git/test-write

# --- 2. 暂存本次改动 ---
echo "📦 暂存当前未提交改动..."
# 把所有 podcast 相关的文件加上 WIP 标记 stash。
STASH_MESSAGE="wip(podcast): fab 播一下 tab — pre-commit baseline"
git stash push -m "$STASH_MESSAGE" || {
  echo "❌ stash 失败;请手动处理未提交改动" >&2
  exit 1
}

# --- 3. 创建 worktree ---
echo "🌳 创建 worktree $BRANCH..."
git worktree add -b "$BRANCH" "$WT_DIR" main || {
  echo "❌ worktree 创建失败;尝试 pop stash 后重试" >&2
  git stash pop || true
  exit 1
}

# --- 4. 在新 worktree apply stash ---
cd "$WT_DIR"
echo "📥 把 WIP 应用到新 worktree..."
git stash pop || {
  echo "❌ stash apply 失败;冲突需要手动解决" >&2
  exit 1
}

# --- 5. 拆成独立 commit ---
echo "✂️  按主题拆分 commit..."

# 5a. 设计 spec
git add docs/superpowers/specs/2026-07-20-fab-podcast-mode-design.md
git commit -m "design(数创智伴): FAB 播客播放模式设计 spec v1

参照本机 MiniCast 项目,在读懂本页 / 协助操作 两 tab 基础上,
增加第三 tab「播一下」,让用户一键生成当前页的双人对谈播客并
内嵌播放。设计涵盖状态机、后端代理架构、降级路径、SSRF 白
名单与验收标准。" || true

# 5b. 后端
git add backend/app/routers/public_podcast_router.py \
        backend/app/routers/__init__.py \
        backend/app/main.py \
        backend/app/services/admin_setting_defaults.py \
        backend/tests/test_public_podcast_router.py
git commit -m "feat(backend): /api/public/podcast/* 代理 MiniCast

- public_podcast_router: extract / generate / download / subtitle /
  config 五个端点,chains 三次 MiniCast 调用为单次 /generate
- 严格 SSRF 白名单:仅 hbsc 自家 /articles/ 与 /issues/ 路由可作为
  播客源,避免把 MiniCast 变成开放代理
- podcast.enabled 与 podcast.minicast_base_url 两个 AdminSetting
  默认值,admin 可在 Settings 页关停
- 速率限制 12 次/分钟/IP,降级路径明确 (503 minicast_unavailable
  → /labs/minicast 工作台)
- 共 15 个 pytest 测试覆盖 SSRF/降级/锁定音色/限流" || true

# 5c. 前端
git add frontend-vite/src/components/ai/PodcastPanel.tsx \
        frontend-vite/src/components/ai/PodcastPanel.module.css \
        frontend-vite/src/components/ai/PageAgentPanel.tsx \
        frontend-vite/src/components/ai/PageAgentFab.tsx \
        frontend-vite/src/components/ai/modeStorage.ts \
        frontend-vite/src/services/api.ts
git commit -m "feat(frontend): 数创智伴 第 3 tab 「播一下」

- PodcastPanel:角色卡 (小数/小创) + 4 段进度 + audio 播放器 +
  MP3/SRT 下载 + 脚本预览;MiniCast 不可达时降级到完整工作台
- PageAgentPanel: modeTabs 加第三个 tab,podcast 模式下 body 切
  到 PodcastPanel,footer (输入框) 隐藏
- modeStorage: AgentMode 扩展为 'ask' | 'operate' | 'podcast',
  引入 isChatHistoryMode 帮助函数隔离 podcast 的无持久化设计
- PageAgentFab 文案微调:副标题改为「读懂 · 操作 · 播一下」
- 配套 api.ts 类型与 api.public.podcast.* 方法" || true

# 5d. e2e
git add frontend-vite/tests/public-page-agent.spec.ts
git commit -m "test(e2e): FAB 三 tab 可达 + 播一下 tab 渲染 PodcastPanel

3 个新 case:
- podcast tab 切换 + 角色卡渲染 + 生成跑通 → audio src 走
  /api/public/podcast/download/<job_id> 代理
- podcast 模式下隐藏 chat 输入框 (footer 不渲染)
- MiniCast 不可达时降级文案 + 跳 /labs/minicast/?embed=1 工作台" || true

# 5e. 脚本
git add scripts/setup-podcast-worktree.sh
git commit -m "chore(scripts): 沙箱外 worktree + commit 引导脚本

Codex 沙箱拒绝写 .git/ 与创建新 worktree。本脚本暂存 WIP → 创建
feat/fab-podcast worktree → apply stash → 按主题拆 5 个 commit。
跑一次即可在沙箱外完成所有 git 写操作。" || true

echo ""
echo "✅ 完成。新 worktree: $WT_DIR"
echo ""
echo "📋 下一步:"
echo "   cd $WT_DIR"
echo "   git log --oneline main..HEAD          # 查看拆分的 5 个 commit"
echo "   bash scripts/dev-up.sh                # 启动 dev (后端 + 前端)"
echo "   # 在文章详情页 (如 http://localhost:5173/articles/<slug>) 点 FAB → 播一下"
echo "   # 完整测试需要 MiniCast 后端在线: cd ~/Projects/MiniCast && python -m minicast server"
echo "   git push origin $BRANCH                # 推到远端"
echo "   gh pr create --base main --head $BRANCH"
