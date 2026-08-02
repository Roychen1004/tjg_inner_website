"""測試設定"""
from .base import *  # noqa: F403

DEBUG = False
ALLOWED_HOSTS = ["*"]

# 測試時用快速雜湊，加速跑測試
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

# 測試時不限流、不鎖帳號
REST_FRAMEWORK["DEFAULT_THROTTLE_CLASSES"] = []  # noqa: F405
AXES_ENABLED = False

CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}

LOGGING["root"]["level"] = "WARNING"  # noqa: F405
