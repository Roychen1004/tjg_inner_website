"""
API 文件視圖

drf-spectacular 的預設視圖會套用 DRF 的全域限流與認證設定，
導致資料庫一有狀況連文件都打不開。文件是靜態內容，不需要這些。
"""
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularRedocView,
    SpectacularSwaggerView,
)
from rest_framework.permissions import AllowAny


class _OpenDocsMixin:
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = []


class SchemaView(_OpenDocsMixin, SpectacularAPIView):
    """OpenAPI 3 YAML（機器可讀，供前端產生 TypeScript 型別）"""


class SwaggerView(_OpenDocsMixin, SpectacularSwaggerView):
    """互動式 API 文件，可直接 Try it out"""


class RedocView(_OpenDocsMixin, SpectacularRedocView):
    """閱讀用 API 文件"""
