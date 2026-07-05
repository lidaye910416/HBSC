"""简单的内存 token-bucket 限流中间件。

仅使用标准库实现，按 (客户端 IP, 端点 key) 限流——每个装饰的端点拥有
独立的 bucket，因此 /execute 和 /llm 不会互相消耗配额。线程安全。
仅支持 IPv4（按 "." 分割）。
"""
import threading
import time
from functools import wraps
from typing import Callable, Dict, Tuple

from fastapi import HTTPException, Request, status

# (客户端 IP, 端点 key) -> (剩余 tokens, 上次补充时间)
# 端点 key 默认用被装饰函数的 __qualname__，也可以通过 key= 参数显式覆盖
# 以保证同一物理端点共享 bucket 即便被多个装饰器函数包装。
_buckets: Dict[Tuple[str, str], Tuple[float, float]] = {}
_lock = threading.Lock()


def _get_client_ip(request: Request) -> str:
    """获取客户端 IP（仅 IPv4 基础处理）。

    优先取 request.client.host，如果其中含 ":" 则按 IPv6 简化处理为
    IPv4 末段；否则直接返回。
    """
    host = request.client.host if request.client else "unknown"
    if not host:
        return "unknown"
    # IPv4 basic split
    return host.split(",")[0].strip()


def _refill(bucket: Tuple[float, float], max_calls: int, window_seconds: float, now: float) -> Tuple[float, float]:
    """根据经过的时间补充 tokens。"""
    tokens, last_refill = bucket
    elapsed = now - last_refill
    if elapsed > 0:
        # 按线性速率补充
        rate = max_calls / window_seconds
        tokens = min(float(max_calls), tokens + elapsed * rate)
    return tokens, now


def reset_buckets() -> None:
    """清空所有 token-bucket。供测试 conftest / 调试使用。"""
    with _lock:
        _buckets.clear()


def consume_token_or_lock(
    request: Request,
    *,
    key: str,
    max_calls: int,
    window_seconds: int,
) -> bool:
    """原子地从 (client_ip, key) bucket 扣 1 个 token。

    返回 True 表示扣到了（bucket 还有余量），返回 False 表示 bucket 已空
    （被锁住）——调用方应当返回 429。

    用于"失败操作计数、成功操作不计"的场景：失败的密码校验调用一次扣
    一个 token，成功路径完全不扣。配合 is_bucket_locked() 使用可以让
    成功路径在 bucket 被锁时仍然返回 429。
    """
    window = float(window_seconds)
    client_ip = _get_client_ip(request)
    bucket_id = (client_ip, key)
    now = time.monotonic()

    with _lock:
        bucket = _buckets.get(bucket_id)
        if bucket is None:
            # 新 bucket：满 token，扣 1 个
            _buckets[bucket_id] = (float(max_calls) - 1, now)
            return True

        tokens, last_refill = _refill(bucket, max_calls, window, now)
        if tokens < 1:
            # 已锁住：保留 bucket 状态，不扣
            _buckets[bucket_id] = (tokens, now)
            return False

        _buckets[bucket_id] = (tokens - 1, now)
        return True


def is_bucket_locked(
    request: Request,
    *,
    key: str,
    max_calls: int,
    window_seconds: int,
) -> bool:
    """检查 (client_ip, key) bucket 当前是否为空（被锁）。

    不扣 token，仅刷新 last_refill 时间以维持正确的补充节奏。
    调用方应当在此返回 True 时返回 429。
    """
    window = float(window_seconds)
    client_ip = _get_client_ip(request)
    bucket_id = (client_ip, key)
    now = time.monotonic()

    with _lock:
        bucket = _buckets.get(bucket_id)
        if bucket is None:
            return False
        tokens, last_refill = _refill(bucket, max_calls, window, now)
        _buckets[bucket_id] = (tokens, now)
        return tokens < 1


def rate_limit(max_calls: int, window_seconds: int, *, key: str | None = None):
    """装饰器：基于 (IP, 端点 key) 的 token bucket 限流。

    超过限制抛出 HTTPException(429, "Rate limit exceeded")。

    关键改动（v2）：bucket 按 (client_ip, key) 隔离——
    /execute 和 /llm 装饰器即便挂在同一个 IP 上也互不影响，
    避免一次 operate 的多步 /llm 调用把 /execute 的配额耗光。
    """
    window = float(window_seconds)

    def decorator(func: Callable):
        endpoint_key = key or func.__qualname__

        @wraps(func)
        def wrapper(*args, **kwargs):
            # 在 kwargs 中查找 Request 对象
            request: Request = kwargs.get("request")
            if request is None:
                for arg in args:
                    if isinstance(arg, Request):
                        request = arg
                        break

            if request is None:
                # 没有 Request 时，不限流（兜底，避免误伤）
                return func(*args, **kwargs)

            client_ip = _get_client_ip(request)
            bucket_id = (client_ip, endpoint_key)
            now = time.monotonic()

            with _lock:
                bucket = _buckets.get(bucket_id)
                if bucket is None:
                    # 首次请求，初始 tokens 为 max_calls
                    _buckets[bucket_id] = (float(max_calls), now)
                    tokens = float(max_calls)
                else:
                    tokens, last_refill = _refill(bucket, max_calls, window, now)
                    _buckets[bucket_id] = (tokens, now)

                if tokens < 1:
                    raise HTTPException(
                        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                        detail="Rate limit exceeded",
                    )

                # 消耗一个 token
                _buckets[bucket_id] = (tokens - 1, now)

            return func(*args, **kwargs)

        return wrapper

    return decorator
