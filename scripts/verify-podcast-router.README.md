# verify-podcast-router.py

直接验证 `public_podcast_router` 行为的脚本。绕过 pytest 子进程
与 `app.main` 的 bcrypt/jose 依赖,只 import 路由模块本体。

**为什么需要这个脚本**:Codex 沙箱会 hang 在 sqlalchemy / fastapi
testclient 启动后的某个 syscall 上,无法跑 pytest。沙箱外的完整环境
可以跑 `pytest tests/test_public_podcast_router.py -v`;本脚本
只验证关键的 SSRF + 音色 catalog + 限流 + 降级 contract。

## 用法

```bash
cd /Users/jasonlee/hubei-shuchuang
python3 scripts/verify-podcast-router.py
```

期望:输出 `=== N passed, 0 failed ===` 其中 N ≥ 25。

## 它验证什么

1. **音色 catalog**:`VOICE_CATALOG` 含 midnight_male/warm_female,
   label 分别是「小数」「小创」
2. **SSRF 白名单**:`_is_allowed_hbsc_url` 接受 hbsc 自家路由,
   拒绝 evil.com/admin/login/file:// 等
3. **/config 端点**:返回 enabled=true + 2 voices + minicast_base_url
4. **/extract SSRF**:evil.com 被 403/422 拦;hbsc.cn → 503 (无 upstream)
5. **/generate 降级**:503 + hint 含 /labs/minicast 工作台链接
6. **Pydantic 校验**:未知 voice_a → 422;锁定音色 validation pass
