#!/usr/bin/env bash
# 依 django_rules.md 建立新模組（app）
# 用法：./shell/create_django_app.sh masters
set -euo pipefail
APP="${1:?用法：./shell/create_django_app.sh <app_name>}"
DIR="main/apps/$APP"

[ -d "$DIR" ] && { echo "✘ $DIR 已存在"; exit 1; }

mkdir -p "$DIR"/{actors,api/views,models,serializers,services,migrations,tests,templates,management/commands}
for d in "$DIR" "$DIR"/{actors,api,api/views,models,serializers,services,migrations,tests,management,management/commands}; do
    touch "$d/__init__.py"
done

cat > "$DIR/apps.py" <<PY
from django.apps import AppConfig


class ${APP^}Config(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "main.apps.$APP"
    label = "$APP"
    verbose_name = "$APP"
PY

cat > "$DIR/api/urls.py" <<PY
from django.urls import path  # noqa: F401

app_name = "$APP"

urlpatterns = []
PY

cat > "$DIR/tests/test_actors.py" <<PY
"""依 django_rules.md：一個 actor 一個 class，命名 Test<Actor.name>"""
from django.test import TestCase


class TestPlaceholder(TestCase):
    def test_placeholder(self):
        self.assertTrue(True)
PY

echo "✔ 已建立 $DIR"
echo ""
echo "接著手動加兩行："
echo "  1. main/settings/base.py 的 LOCAL_APPS 加入 \"main.apps.$APP\""
echo "  2. main/urls.py 加入 path(f\"{API}/\", include(\"main.apps.$APP.api.urls\"))"
