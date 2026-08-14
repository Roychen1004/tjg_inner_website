.PHONY: help dev up down build logs migrate makemigrations seed shell test lint api-types stats backup

PY  := ./.venv/bin/python
DC  := docker compose

help:
	@echo "鐵正綱工程 內部管理系統"
	@echo ""
	@echo "  make build         建置映像（前端 React 在此編譯成靜態檔）"
	@echo "  make up            啟動 3 個服務（web / api / db）"
	@echo "  make down          停止全部"
	@echo "  make logs          追蹤日誌"
	@echo "  make migrate       套用 migration"
	@echo "  make seed          載入階段模板、角色與帳號"
	@echo "  make test          跑測試"
	@echo "  make lint          ruff 檢查"
	@echo "  make api-types     產生 OpenAPI 並轉成前端 TypeScript 型別"
	@echo "  make stats         看記憶體用量（目標常駐 < 1.5GB）"
	@echo "  make pgadmin       啟動 pgAdmin（用完記得 make pgadmin-stop）"
	@echo "  make backup        備份資料庫與附件"
	@echo "  make verify        驗證環境設定"
	@echo "  make verify-flow   全流程整合驗收（49 項，需系統已啟動）"

# ── Docker ────────────────────────────────────────────────────────────
build:
	$(DC) build

up:
	$(DC) up -d
	@echo "→ http://localhost:30080                  前端"
	@echo "→ http://localhost:30080/admin/           Django Admin"
	@echo "→ http://localhost:30080/api/v0.1/swagger API 文件"
	@echo "  （除錯用：api 直連 :30800 ／ PostgreSQL :30432）"

down:
	$(DC) down

logs:
	$(DC) logs -f --tail=100

restart:
	$(DC) restart api

# ── Django ────────────────────────────────────────────────────────────
migrate:
	$(DC) exec api python manage.py migrate

makemigrations:
	$(DC) exec api python manage.py makemigrations

seed:
	$(DC) exec api python manage.py createcachetable
	$(DC) exec api python manage.py seed_masters
	$(DC) exec api python manage.py seed_accounts

seed-demo:
	$(DC) exec api python manage.py seed_demo

shell:
	$(DC) exec api python manage.py shell

superuser:
	$(DC) exec api python manage.py createsuperuser

collectstatic:
	$(DC) exec api python manage.py collectstatic --noinput

# ── 品質 ──────────────────────────────────────────────────────────────
test:
	$(DC) exec -e DJANGO_SETTINGS_MODULE=main.settings.test api pytest -q

lint:
	$(PY) -m ruff check main/
	$(PY) -m ruff format --check main/

verify:
	POSTGRES_HOST=127.0.0.1 $(PY) shell/verify_setup.py

# 附件與現金流的整合驗收（68 項）。一定要打過 nginx——附件下載走
# X-Accel-Redirect，直連 api:8000 會拿到 0 bytes，而那正是要驗的東西之一。
# 用 api 映像跑是因為照片壓縮與 EXIF 的測試需要 Pillow
verify-flow:
	python3 shell/verify.py

# ── 前端型別同步 ──────────────────────────────────────────────────────
api-types:
	$(DC) exec -T api python manage.py spectacular --file /app/openapi.yaml
	$(DC) cp api:/app/openapi.yaml ./openapi.yaml
	docker run --rm -v "$$PWD:/w" -w /w node:22-alpine \
		npx --yes openapi-typescript@7 openapi.yaml -o web/src/api/schema.d.ts
	@echo "✔ 前端型別已同步。後端改了欄位型別，前端 tsc 會立刻報錯"

# ── 維運 ──────────────────────────────────────────────────────────────
stats:
	docker stats --no-stream --format "table {{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}"

pgadmin:
	$(DC) --profile tools up -d pgadmin
	@echo "→ http://127.0.0.1:30050  （不用登入，左側已有 TJG PostgreSQL）"

pgadmin-stop:
	$(DC) stop pgadmin && $(DC) rm -f pgadmin

backup:
	./deploy/backup.sh

# ── 本機開發（不用 Docker，需自備 PostgreSQL）─────────────────────────
dev:
	POSTGRES_HOST=127.0.0.1 $(PY) manage.py runserver 0.0.0.0:8000
