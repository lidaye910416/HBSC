"""简单的内存 token-bucket 限流中间件。

仅使用标准库实现，按客户端 IP 限流。线程安全。
仅支持 IPv4（按 "." 分割）。
"""
import threading
import time
from functools import wraps
from typing import Callable, Dict, Tuple

from fastapi import HTTPException, Request, status

# 客户端 IP -> (剩余 tokens, 上次补充时间)
_buckets: Dict[str, Tuple[float, float]] = {}
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


def rate_limit(max_calls: int, window_seconds: int):
    """装饰器：基于 IP 的 token bucket 限流。

    超过限制抛出 HTTPException(429, "Rate limit exceeded")。
    """
    window = float(window_seconds)

    def decorator(func: Callable):
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
            now = time.monotonic()

            with _lock:
                bucket = _buckets.get(client_ip)
                if bucket is None:
                    # 首次请求，初始 tokens 为 max_calls
                    _buckets[client_ip] = (float(max_calls), now)
                    tokens = float(max_calls)
                else:
                    tokens, last_refill = _refill(bucket, max_calls, window, now)
                    _buckets[client_ip] = (tokens, now)

                if tokens < 1:
                    raise HTTPException(
                        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                        detail="Rate limit exceeded",
                    )

                # 消耗一个 token
                _buckets[client_ip] = (tokens - 1, now)

            return func(*args, **kwargs)

        return wrapper

    return decorator
