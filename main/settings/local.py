"""本地開發設定"""
from .base import *  # noqa: F403

DEBUG = True
ALLOWED_HOSTS = ["*"]

# 開發套件一律做成「有裝才啟用」。
# 因為 requirements 分四份，映像可能是用 production.txt 建的，
# 硬性 import 會讓容器直接 boot 失敗。
import importlib.util  # noqa: E402


def _installed(module: str) -> bool:
    return importlib.util.find_spec(module) is not None


if _installed("django_extensions"):
    INSTALLED_APPS += ["django_extensions"]  # noqa: F405

# N+1 查詢偵測：開發時直接拋錯，逼在寫的當下就修掉
NPLUSONE_RAISE = True
if _installed("nplusone"):
    INSTALLED_APPS += ["nplusone.ext.django"]  # noqa: F405
    MIDDLEWARE.insert(0, "nplusone.ext.django.NPlusOneMiddleware")  # noqa: F405

# 開發時放寬流量限制
REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"] = {  # noqa: F405
    "anon": "200/min",
    "user": "2000/min",
    "login": "60/min",
    "upload": "200/hour",
}

# 開發時 Swagger 不限 IP
SPECTACULAR_SETTINGS["SERVE_PUBLIC"] = True  # noqa: F405

LOGGING["root"]["level"] = "DEBUG"  # noqa: F405
