"""產能與成本統計端點（D52 第一期）

權限（老闆 2026-08-30 定）：
  產能（涉及員工表現評比）＝經理＋系統管理員（view_productivity）
  金額類（單價、流程花費）＝照現行 view_money（經理＋會計）
"""
import datetime as dt

from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from main.apps.analytics.services import stats_service
from main.utils.permissions import HasPermission


def _period(request, default_days=90):
    """?start=YYYY-MM-DD&end=YYYY-MM-DD；預設近 90 天。"""
    today = timezone.localdate()
    try:
        start = dt.date.fromisoformat(request.query_params.get("start", ""))
    except ValueError:
        start = today - dt.timedelta(days=default_days)
    try:
        end = dt.date.fromisoformat(request.query_params.get("end", ""))
    except ValueError:
        end = today
    if end < start:
        start, end = end, start
    return start, end


@extend_schema(
    responses=OpenApiTypes.OBJECT,
    description="員工產能與公司各類型產能。回傳形狀見 web/src/api/types.ts 的 ProductivityStats",
)
class ProductivityStatsView(APIView):
    """GET /stats/productivity?start=&end= —— 誰、哪類工作、多少量、幾工"""

    permission_classes = [HasPermission]
    required_permission = "view_productivity"

    def get(self, request):
        start, end = _period(request)
        data = stats_service.productivity_stats(start, end)
        return Response({"start": start, "end": end, **data})


@extend_schema(
    responses=OpenApiTypes.OBJECT,
    description="各品項採購單價走勢。回傳形狀見 web/src/api/types.ts 的 UnitPriceStats",
)
class UnitPriceStatsView(APIView):
    """GET /stats/unit-prices —— 鋼材每噸多少、越買越貴還是越便宜"""

    permission_classes = [HasPermission]
    required_permission = "view_money"

    def get(self, request):
        return Response(stats_service.unit_price_stats())


@extend_schema(
    responses=OpenApiTypes.OBJECT,
    description="每類流程平均花費。回傳形狀見 web/src/api/types.ts 的 FlowCostStats",
)
class FlowCostStatsView(APIView):
    """GET /stats/flow-costs —— 加工類流程平均一次花多少錢"""

    permission_classes = [HasPermission]
    required_permission = "view_money"

    def get(self, request):
        return Response(stats_service.flow_cost_stats())
