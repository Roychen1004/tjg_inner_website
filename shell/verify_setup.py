"""
環境設定驗證 —— 不需要資料庫就能跑

驗證路由規範、健康檢查的降級行為、統一錯誤格式、API 文件可存取，
以及幾條寫進決策紀錄的硬規則（金額字串化、分頁上限、不用 Redis…）。

用法：
    POSTGRES_HOST=127.0.0.1 ./.venv/bin/python shell/verify_setup.py
或
    make verify
"""

import json
import os
import sys
from pathlib import Path

import django

# 從 shell/ 執行時，專案根目錄不在 sys.path 上
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "main.settings.local")
django.setup()

from django.conf import settings  # noqa: E402
from django.test import Client  # noqa: E402
from django.urls import get_resolver  # noqa: E402

from main.utils.pagination import StandardPagination  # noqa: E402

client = Client()
_failures = []


def check(label, condition, extra=""):
    mark = "PASS" if condition else "FAIL"
    print(f"  [{mark}] {label}{('  ' + extra) if extra else ''}")
    if not condition:
        _failures.append(label)


def collect_url_patterns():
    found = []

    def walk(resolver, prefix=""):
        for entry in resolver.url_patterns:
            path = prefix + str(entry.pattern)
            if hasattr(entry, "url_patterns"):
                walk(entry, path)
            else:
                found.append(path)

    walk(get_resolver())
    return found


print("\n=== 1. 健康檢查（資料庫故意連不上，應優雅降級而非 500）===")
response = client.get("/api/v0.1/health")
body = response.json()
check("HTTP 503", response.status_code == 503, f"got {response.status_code}")
check("status = degraded", body.get("status") == "degraded")
check("回報 api_version", body.get("api_version") == settings.API_VERSION)
check("database.connected = False", body["database"]["connected"] is False)
check("附帶錯誤訊息可診斷", bool(body["database"].get("error")))

print("\n=== 2. 統一錯誤格式（決策 T06：不存在／無權限一律 404）===")
check("未定義路徑回 404", client.get("/api/v0.1/nonexistent").status_code == 404)

print("\n=== 3. API 文件（資料庫斷線時仍須可存取）===")
for path, name in [
    ("/api/v0.1/schema", "OpenAPI YAML"),
    ("/api/v0.1/swagger", "Swagger UI"),
    ("/api/v0.1/redoc", "ReDoc"),
]:
    code = client.get(path).status_code
    check(f"{name} 可存取", code == 200, f"HTTP {code}")

print("\n=== 4. 路徑符合 django_rules.md 規範 ===")
api_paths = sorted(p for p in collect_url_patterns() if p.startswith("api/"))
check("前綴為 api/v0.1", all(p.startswith(f"{settings.API_PREFIX}/") for p in api_paths))
check("結尾不加斜線", all(not p.endswith("/") for p in api_paths))
for path in api_paths:
    print(f"       /{path}")

print("\n=== 5. 決策紀錄裡的硬規則 ===")
check("金額用字串傳輸（T01）", settings.REST_FRAMEWORK["COERCE_DECIMAL_TO_STRING"] is True)
check("分頁硬上限 100（D07）", StandardPagination.max_page_size == 100)
check("不使用 Redis（D05）", "redis" not in json.dumps(settings.CACHES).lower())
check("Session 存資料庫（T02）", settings.SESSION_ENGINE.endswith("backends.db"))
check("限流不打資料庫（D07）", "locmem" in settings.CACHES["throttle"]["BACKEND"].lower())
check("資料庫存 UTC", settings.USE_TZ is True)
check("顯示時區 Asia/Taipei", settings.TIME_ZONE == "Asia/Taipei")
check("登入失敗 5 次鎖定", settings.AXES_FAILURE_LIMIT == 5)
check("附件上限 20MB", settings.MAX_UPLOAD_SIZE_MB == 20)

print("\n" + "=" * 54)
if _failures:
    print(f"  驗證失敗 ✘　共 {len(_failures)} 項：")
    for item in _failures:
        print(f"    · {item}")
else:
    print("  環境驗證全部通過 ✔")
print("=" * 54 + "\n")

sys.exit(1 if _failures else 0)
