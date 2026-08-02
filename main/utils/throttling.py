"""
限流

DRF 預設把限流計數寫在 `default` 快取。我們的 `default` 是資料庫快取
（因為儀表板快取必須跨 worker 共用），若直接沿用，**每一個 API 請求都會
多打一次資料庫**——在 max_connections=50 的 8GB 主機上是不必要的成本，
而且資料庫一有狀況連 API 文件都會 500。

因此限流改用 `throttle` 快取（LocMemCache，每個 worker 各自計數）。
代價是實際上限會變成「設定值 × worker 數」，對內部系統可以接受：
暴力破解由 django-axes 另外擋（5 次鎖 15 分鐘），限流只是防跑掉的 client。
"""
from django.core.cache import caches
from rest_framework.throttling import AnonRateThrottle, SimpleRateThrottle, UserRateThrottle


class _LocalCacheMixin:
    cache = caches["throttle"]


class AnonThrottle(_LocalCacheMixin, AnonRateThrottle):
    pass


class UserThrottle(_LocalCacheMixin, UserRateThrottle):
    pass


class LoginThrottle(_LocalCacheMixin, SimpleRateThrottle):
    """登入端點：依 IP 計數"""

    scope = "login"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


class UploadThrottle(_LocalCacheMixin, SimpleRateThrottle):
    """檔案上傳：依使用者計數"""

    scope = "upload"

    def get_cache_key(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return None
        return self.cache_format % {"scope": self.scope, "ident": request.user.pk}
