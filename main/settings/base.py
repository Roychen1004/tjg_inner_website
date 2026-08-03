"""
共用設定（所有環境繼承此檔）

依 docs/開發/07_Django程式規範.md：settings 分 base / local / production / test
"""
import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent.parent

load_dotenv(BASE_DIR / "deploy" / ".env")

# ── 基本 ───────────────────────────────────────────────────────────────
SECRET_KEY = os.environ["SECRET_KEY"]
DEBUG = os.environ.get("DEBUG", "False").lower() == "true"
ALLOWED_HOSTS = [h.strip() for h in os.environ.get("ALLOWED_HOSTS", "").split(",") if h.strip()]

# 服務跑在非標準埠（30080）時，Django 的 CSRF 檢查需要明確信任該來源，
# 否則 Admin 登入與所有 POST 都會被擋。格式必須含協定與埠號。
CSRF_TRUSTED_ORIGINS = [
    o.strip() for o in os.environ.get("CSRF_TRUSTED_ORIGINS", "").split(",") if o.strip()
]

API_ROOT = os.environ.get("API_ROOT", "api")
API_VERSION = os.environ.get("API_VERSION", "v0.1")
API_PREFIX = f"{API_ROOT}/{API_VERSION}"

AUTH_USER_MODEL = "core.User"

# ── 應用程式 ───────────────────────────────────────────────────────────
DJANGO_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.postgres",
]

THIRD_PARTY_APPS = [
    "rest_framework",
    "django_filters",
    "drf_spectacular",
    "simple_history",
    "axes",
]

# 依 django_rules.md，模組一律放 main/apps/
LOCAL_APPS = [
    "main.apps.core",
    "main.apps.masters",
    "main.apps.projects",
    "main.apps.tracking",
    "main.apps.billing",
    "main.apps.production",
    "main.apps.inventory",
    "main.apps.assets",
    "main.apps.analytics",
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "simple_history.middleware.HistoryRequestMiddleware",
    # AxesMiddleware 必須放最後
    "axes.middleware.AxesMiddleware",
]

ROOT_URLCONF = "main.urls"
WSGI_APPLICATION = "main.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "main" / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# ── 資料庫 ─────────────────────────────────────────────────────────────
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "HOST": os.environ.get("POSTGRES_HOST", "db"),
        "PORT": os.environ.get("POSTGRES_PORT", "5432"),
        "NAME": os.environ.get("POSTGRES_DB", "tjg"),
        "USER": os.environ.get("POSTGRES_USER", "tjg"),
        "PASSWORD": os.environ.get("POSTGRES_PASSWORD", ""),
        # 連線復用 60 秒，降低建立連線的成本（8GB 主機 max_connections=50）
        "CONN_MAX_AGE": 60,
        "OPTIONS": {"connect_timeout": 10},
    }
}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ── 認證 ───────────────────────────────────────────────────────────────
AUTHENTICATION_BACKENDS = [
    # AxesStandaloneBackend 必須放第一個
    "axes.backends.AxesStandaloneBackend",
    "django.contrib.auth.backends.ModelBackend",
]

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
     "OPTIONS": {"min_length": 8}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
]

# django-axes：連續 5 次失敗鎖 15 分鐘（決策 D21 相關）
AXES_FAILURE_LIMIT = 5
AXES_COOLOFF_TIME = 0.25  # 小時 = 15 分鐘
AXES_LOCKOUT_PARAMETERS = ["ip_address", "username"]
AXES_RESET_ON_SUCCESS = True

# ── Session（決策 T02：用 Session Cookie 而非 JWT）─────────────────────
SESSION_ENGINE = "django.contrib.sessions.backends.db"  # 不用 Redis
SESSION_COOKIE_AGE = 8 * 60 * 60          # 8 小時
SESSION_SAVE_EVERY_REQUEST = True         # 有活動就延長
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"
IDLE_TIMEOUT_SECONDS = 2 * 60 * 60        # 閒置 2 小時自動登出

# ── 快取：用資料庫表（不用 Redis）──────────────────────────────────────
CACHES = {
    # 儀表板等需要跨 worker 共用的快取
    "default": {
        "BACKEND": "django.core.cache.backends.db.DatabaseCache",
        "LOCATION": "core_cache_table",
        "TIMEOUT": 60,
    },
    # 限流計數：每個 worker 各自計，避免每個請求都多打一次資料庫
    "throttle": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "throttle",
    },
}

# ── 國際化 ─────────────────────────────────────────────────────────────
LANGUAGE_CODE = os.environ.get("LANGUAGE_CODE", "zh-hant")
TIME_ZONE = os.environ.get("TIME_ZONE", "Asia/Taipei")
USE_I18N = True
USE_TZ = True  # 資料庫存 UTC，顯示轉 Asia/Taipei

# ── 靜態檔與媒體 ───────────────────────────────────────────────────────
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "media/"
MEDIA_ROOT = os.environ.get("MEDIA_ROOT", str(BASE_DIR / "media"))

MAX_UPLOAD_SIZE_MB = int(os.environ.get("MAX_UPLOAD_SIZE_MB", "20"))
MAX_UPLOAD_SIZE = MAX_UPLOAD_SIZE_MB * 1024 * 1024
ALLOWED_UPLOAD_EXTENSIONS = ["pdf", "jpg", "jpeg", "png", "xlsx", "dwg"]

# ── DRF ────────────────────────────────────────────────────────────────
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_PAGINATION_CLASS": "main.utils.pagination.StandardPagination",
    "PAGE_SIZE": 20,
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "EXCEPTION_HANDLER": "main.utils.exceptions.tjg_exception_handler",
    "DEFAULT_THROTTLE_CLASSES": [
        "main.utils.throttling.AnonThrottle",
        "main.utils.throttling.UserThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": "20/min",
        "user": "300/min",
        # 20 而不是 10：這個計數包含**成功**的登入，
        # 而測試與教育訓練時常要連續切換多個角色帳號登入。
        # 真正擋暴力破解的是 django-axes（連續 5 次失敗即鎖定），
        # 這裡只是防洪水，不該把正常操作也擋掉。
        "login": "20/min",
        "upload": "30/hour",
    },
    "DATETIME_FORMAT": "%Y-%m-%dT%H:%M:%SZ",
    "COERCE_DECIMAL_TO_STRING": True,  # 金額用字串傳輸，避免 JS 浮點誤差
}

SPECTACULAR_SETTINGS = {
    "TITLE": "鐵正綱工程 內部管理系統 API",
    "DESCRIPTION": "土建＋鋼構雙軌進度追蹤、請款、資產與庫存管理",
    "VERSION": API_VERSION,
    "SERVE_INCLUDE_SCHEMA": False,
    "COMPONENT_SPLIT_REQUEST": True,
    "SCHEMA_PATH_PREFIX": f"/{API_PREFIX}",
    "SORT_OPERATIONS": False,
}

# ── 日誌（依 django_rules.md：logs 按日分檔）───────────────────────────
LOGS_DIR = Path(os.environ.get("LOGS_FOLDER_PATH", BASE_DIR / "logs"))


def _logs_writable(path):
    """日誌目錄能不能寫。

    ⚠️ 這個檢查存在的理由是一次真實的部署失敗：

    `./logs` 被 .gitignore 排除，所以 git clone 出來沒有這個目錄。
    docker compose 遇到不存在的 bind mount 來源會**用 root 建一個**，
    而容器跑的是非 root 的 tjg(uid 1000)——寫不進去。
    Django 在 setup() 階段就因為建不了 FileHandler 而炸掉，
    api 容器陷入無限重啟，錯誤訊息埋在 log 裡看不見。

    日誌寫不了是運維問題，不該讓整個系統起不來。
    寫得了就寫檔案（公司慣例：按日分檔），寫不了就退回只輸出到 stdout——
    `docker compose logs` 一樣看得到，服務照常運作。
    """
    try:
        path.mkdir(parents=True, exist_ok=True)
        probe = path / ".write_probe"
        probe.touch()
        probe.unlink()
        return True
    except OSError:
        return False


LOGS_WRITABLE = _logs_writable(LOGS_DIR)

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "verbose": {
            "format": "[{asctime}] {levelname} {name}:{lineno} {message}",
            "style": "{",
        },
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "verbose"},
        "app_file": {
            "class": "logging.handlers.TimedRotatingFileHandler",
            "filename": str(LOGS_DIR / "app.log"),
            "when": "midnight",
            "backupCount": 30,
            "encoding": "utf-8",
            "formatter": "verbose",
        },
        "error_file": {
            "class": "logging.handlers.TimedRotatingFileHandler",
            "filename": str(LOGS_DIR / "error.log"),
            "when": "midnight",
            "backupCount": 30,
            "encoding": "utf-8",
            "formatter": "verbose",
            "level": "ERROR",
        },
    },
    "root": {"handlers": ["console", "app_file"], "level": "INFO"},
    "loggers": {
        "django.request": {
            "handlers": ["console", "error_file"],
            "level": "ERROR",
            "propagate": False,
        },
        "tjg": {"handlers": ["console", "app_file", "error_file"], "level": "INFO", "propagate": False},
    },
}

if not LOGS_WRITABLE:
    # 目錄不可寫 → 拿掉檔案 handler，只留 console。
    # 在 stderr 講一聲，因為這是需要有人去修的環境問題
    import sys

    LOGGING["handlers"].pop("app_file")
    LOGGING["handlers"].pop("error_file")
    LOGGING["root"]["handlers"] = ["console"]
    for logger in LOGGING["loggers"].values():
        logger["handlers"] = ["console"]
    print(
        f"[warn] 日誌目錄 {LOGS_DIR} 不可寫，改為只輸出到 stdout。\n"
        f"[warn] 要恢復檔案日誌：在宿主機執行 "
        f"`mkdir -p logs && sudo chown -R 1000:1000 logs`",
        file=sys.stderr,
    )

# ── 系統業務常數（可被 core_systemparameter 覆寫）─────────────────────
SIGNOFF_OVERDUE_DAYS = 7        # 進場簽收逾時
CLAIMABLE_OVERDUE_DAYS = 7      # 可請款未開單逾時
RECEIVABLE_OVERDUE_DAYS = 60    # 已請款未收款逾時
OUTSOURCE_WARN_DAYS = 1         # 外包逾期警示
OUTSOURCE_ALERT_DAYS = 7        # 外包逾期升級
NOTIFICATION_DEDUP_DAYS = 3     # 同一件事幾天內不重複通知
