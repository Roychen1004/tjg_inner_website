"""正式環境設定"""
import os

from .base import *  # noqa: F403

DEBUG = False

# ── HTTPS ─────────────────────────────────────────────────────────────
# 內部區網初期可能還沒有憑證，先跑 HTTP。設 USE_HTTPS=False 關閉強制轉址，
# 否則會在純 HTTP 環境造成無限重導。
# ⚠️ 只要系統要讓工地主任從外面連進來，就必須改回 True 並裝憑證。
USE_HTTPS = os.environ.get("USE_HTTPS", "True").lower() == "true"

SECURE_SSL_REDIRECT = USE_HTTPS
SESSION_COOKIE_SECURE = USE_HTTPS
CSRF_COOKIE_SECURE = USE_HTTPS
SECURE_HSTS_SECONDS = 31536000 if USE_HTTPS else 0
SECURE_HSTS_INCLUDE_SUBDOMAINS = USE_HTTPS

SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"

# nginx 反向代理後判斷原始協定
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# 附件由 Django 檢查權限後交給 nginx 送出（決策 T11）
USE_X_ACCEL_REDIRECT = True
X_ACCEL_MEDIA_PREFIX = "/protected-media/"

if not ALLOWED_HOSTS:  # noqa: F405
    raise RuntimeError("正式環境必須設定 ALLOWED_HOSTS")
