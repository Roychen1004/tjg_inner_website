#!/usr/bin/env bash
# 每日備份：資料庫 + 附件
# 見 docs/07_系統架構與開發路線圖.md §7
set -euo pipefail

TJG="${TJG_HOME:-/opt/tjg-inner}"
BACKUP_DIR="${BACKUP_DIR:-$TJG/backups}"
KEEP_DAYS=14
DATE=$(date +%Y%m%d_%H%M)

mkdir -p "$BACKUP_DIR/media"

echo "[$(date '+%F %T')] 開始備份"

# 1. 資料庫（custom format，可選擇性還原單表）
docker compose -f "$TJG/docker-compose.yml" exec -T db \
    pg_dump -U tjg -Fc tjg > "$BACKUP_DIR/db_$DATE.dump"
echo "  ✔ 資料庫 → db_$DATE.dump ($(du -h "$BACKUP_DIR/db_$DATE.dump" | cut -f1))"

# 2. 附件（增量）
MEDIA_VOL=$(docker volume inspect tjg-inner_media --format '{{.Mountpoint}}' 2>/dev/null || echo "")
if [ -n "$MEDIA_VOL" ] && [ -d "$MEDIA_VOL" ]; then
    rsync -a --delete "$MEDIA_VOL/" "$BACKUP_DIR/media/"
    echo "  ✔ 附件已同步"
fi

# 3. 清理本機舊備份
find "$BACKUP_DIR" -name 'db_*.dump' -mtime +$KEEP_DAYS -delete
echo "  ✔ 已清理 $KEEP_DAYS 天前的備份"

# 4. 異地備份（設定 OFFSITE 環境變數後啟用）
if [ -n "${OFFSITE:-}" ]; then
    rsync -az "$BACKUP_DIR/" "$OFFSITE"
    echo "  ✔ 已同步至異地：$OFFSITE"
else
    echo "  ⚠ 未設定 OFFSITE，僅有本機備份"
fi

echo "[$(date '+%F %T')] 備份完成"

# ── 還原步驟（緊急時參考）────────────────────────────────────────────
# docker compose down
# docker volume rm tjg-inner_pgdata && docker volume create tjg-inner_pgdata
# docker compose up -d db && sleep 15
# docker compose exec -T db pg_restore -U tjg -d tjg --clean < backups/db_YYYYMMDD_HHMM.dump
# rsync -a backups/media/ "$(docker volume inspect tjg-inner_media --format '{{.Mountpoint}}')/"
# docker compose up -d
#
# ⚠ 沒有演練過的備份等於沒有備份。每季在測試環境完整還原一次。
