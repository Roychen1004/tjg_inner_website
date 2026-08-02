"""
Log decorator（依 django_rules.md：utils 放整個 project 可用的工具）

用法：
    @log_call
    def move_stage(unit, direction, user):
        ...
"""
import functools
import logging
import time

logger = logging.getLogger("tjg")


def log_call(func=None, *, level=logging.INFO, log_args=False):
    """記錄函式呼叫、耗時與例外。

    log_args 預設 False——業務函式的參數常含金額與人名，
    預設不寫進 log，需要時才逐一開啟。
    """

    def decorator(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            name = f"{fn.__module__}.{fn.__qualname__}"
            started = time.perf_counter()
            if log_args:
                logger.log(level, "→ %s args=%s kwargs=%s", name, args, kwargs)
            else:
                logger.log(level, "→ %s", name)
            try:
                result = fn(*args, **kwargs)
            except Exception:
                elapsed = (time.perf_counter() - started) * 1000
                logger.exception("✗ %s 失敗（%.1f ms）", name, elapsed)
                raise
            elapsed = (time.perf_counter() - started) * 1000
            if elapsed > 500:
                logger.warning("✓ %s 完成但偏慢（%.1f ms）", name, elapsed)
            else:
                logger.log(level, "✓ %s（%.1f ms）", name, elapsed)
            return result

        return wrapper

    return decorator(func) if func else decorator
