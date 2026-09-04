"""
全部模組的母路徑

依 django_rules.md：
    <domain_name>/api/<version>/
    路徑結尾不加 "/"
"""
from django.conf import settings
from django.conf.urls.static import static
from django.urls import include, path

from main.apps.core.api.views import RedocView, SchemaView, SwaggerView

API = settings.API_PREFIX  # api/v0.1

urlpatterns = [
    # ── API 文件（正式環境由 nginx 限制內網 IP）──────────────────────
    path(f"{API}/schema", SchemaView.as_view(), name="schema"),
    path(f"{API}/swagger", SwaggerView.as_view(url_name="schema"), name="swagger"),
    path(f"{API}/redoc", RedocView.as_view(url_name="schema"), name="redoc"),

    # ── 各模組 ───────────────────────────────────────────────────────
    path(f"{API}/", include("main.apps.core.api.urls")),
    path(f"{API}/", include("main.apps.masters.api.urls")),
    path(f"{API}/", include("main.apps.projects.api.urls")),
    path(f"{API}/", include("main.apps.tracking.api.urls")),
    path(f"{API}/", include("main.apps.billing.api.urls")),
    path(f"{API}/", include("main.apps.payables.api.urls")),
    path(f"{API}/", include("main.apps.analytics.api.urls")),
    path(f"{API}/", include("main.apps.affairs.api.urls")),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
