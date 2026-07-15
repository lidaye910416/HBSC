import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
//
// API_TARGET controls the dev-server proxy destination for /api/* and /uploads/*.
// Default: http://localhost:8000 (matches docker-compose / quickstart docs).
// Override per-worktree or per-environment via frontend-vite/.env.local, e.g.
//   API_TARGET=http://localhost:8083
// This lets multiple hbsc worktrees (or worktree-vs-main) run side-by-side
// without colliding on the backend port.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.API_TARGET || 'http://localhost:8000'

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5173,
      host: true,
      proxy: {
        // 开发期代理：/api/* → ${apiTarget}/api/*
        // 生产环境由 Nginx 处理（部署时同样规则）
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
        '/uploads': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
