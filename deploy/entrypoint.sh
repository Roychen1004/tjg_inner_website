#!/usr/bin/env sh
# api 容器啟動流程
set -e

echo "[entrypoint] 等待資料庫就緒…"
python - <<'PY'
import os, sys, time
import psycopg

dsn = (
    f"host={os.environ.get('POSTGRES_HOST', 'db')} "
    f"port={os.environ.get('POSTGRES_PORT', '5432')} "
    f"dbname={os.environ.get('POSTGRES_DB', 'tjg')} "
    f"user={os.environ.get('POSTGRES_USER', 'tjg')} "
    f"password={os.environ.get('POSTGRES_PASSWORD', '')}"
)
for attempt in range(1, 31):
    try:
        with psycopg.connect(dsn, connect_timeout=3):
            print(f"[entrypoint] 資料庫已就緒（第 {attempt} 次嘗試）")
            sys.exit(0)
    except Exception as exc:
        print(f"[entrypoint] 等待中… ({attempt}/30) {exc.__class__.__name__}")
        time.sleep(2)
print("[entrypoint] 資料庫連線逾時", file=sys.stderr)
sys.exit(1)
PY

# Django Admin 與 Swagger UI 的靜態檔。DEBUG=False 時沒有這步，
# Admin 會整個沒有 CSS。
echo "[entrypoint] 收集靜態檔…"
python manage.py collectstatic --noinput --clear >/dev/null
echo "[entrypoint] 靜態檔完成"

# 快取表（限流以外的共用快取用；決策 D05：不用 Redis）
python manage.py createcachetable 2>/dev/null || true

if [ "${AUTO_MIGRATE:-false}" = "true" ]; then
    echo "[entrypoint] 套用 migration…"
    python manage.py migrate --noinput
fi

echo "[entrypoint] 啟動 $*"
exec "$@"
