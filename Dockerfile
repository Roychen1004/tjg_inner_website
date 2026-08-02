# ── Django 後端 ──────────────────────────────────────────────────────
# 目標映像 < 250MB（見 07_系統架構 §3.4）
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# libmagic 供附件的 magic bytes 驗證使用
RUN apt-get update \
    && apt-get install -y --no-install-recommends libmagic1 curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ARG REQUIREMENTS=production
COPY requirements/ /app/requirements/
RUN pip install -r /app/requirements/${REQUIREMENTS}.txt

COPY . /app/

COPY deploy/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
    && mkdir -p /app/logs /app/media /app/staticfiles

# 不用 root 跑
RUN useradd --create-home --shell /bin/bash tjg \
    && chown -R tjg:tjg /app
USER tjg

EXPOSE 8000

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

# --max-requests 1000：每個 worker 處理 1000 次請求後自動重啟，
# 杜絕記憶體緩慢累積（8GB 主機的關鍵設定）
CMD ["gunicorn", "main.wsgi:application", \
     "--bind", "0.0.0.0:8000", \
     "--workers", "3", \
     "--threads", "2", \
     "--worker-class", "gthread", \
     "--max-requests", "1000", \
     "--max-requests-jitter", "100", \
     "--timeout", "60", \
     "--graceful-timeout", "30", \
     "--access-logfile", "-", \
     "--error-logfile", "-"]
