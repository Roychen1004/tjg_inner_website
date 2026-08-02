"""健康檢查：回傳資料庫連線狀態與版本，供監控與 Docker healthcheck 使用"""
import django
from django.conf import settings
from django.db import connection
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView


class HealthView(APIView):
    """GET /api/v0.1/health — 不需登入"""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = []

    @extend_schema(
        summary="健康檢查",
        description="回傳服務與資料庫狀態。不需登入，供監控與容器健康檢查使用。",
        responses={200: None, 503: None},
        tags=["系統"],
    )
    def get(self, request):
        db_ok, db_error = True, None
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
                cursor.fetchone()
        except Exception as exc:  # noqa: BLE001
            db_ok, db_error = False, str(exc)

        payload = {
            "status": "ok" if db_ok else "degraded",
            "api_version": settings.API_VERSION,
            "django": django.get_version(),
            "database": {"connected": db_ok, **({"error": db_error} if db_error else {})},
        }
        code = status.HTTP_200_OK if db_ok else status.HTTP_503_SERVICE_UNAVAILABLE
        return Response(payload, status=code)
