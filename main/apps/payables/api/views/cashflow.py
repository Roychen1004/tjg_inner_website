"""現金流預測與專案損益的端點"""
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from main.apps.payables.services import cashflow_service
from main.apps.projects.models import Project
from main.utils.choices import Certainty
from main.utils.permissions import has_permission
from main.utils.scoping import can_view_amount, scope_projects

MAX_PERIODS = {"week": 26, "month": 24}


class CashflowForecastView(APIView):
    """未來哪個月會缺錢。

    只給經理與會計師——這是全公司的資金狀況。
    專案負責人看得到自己案子的損益（見下面的 ProjectPnlView），
    但不需要看到公司整體的資金部位。
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(
        parameters=[
            OpenApiParameter("granularity", str, description="week（預設）｜month"),
            OpenApiParameter("periods", int, description="幾格，週最多 26、月最多 24"),
            OpenApiParameter("certainty", str, description="confirmed,likely,estimated 逗號分隔"),
            OpenApiParameter("project", int, description="只看單一專案"),
        ],
        responses=OpenApiTypes.OBJECT,
    )
    def get(self, request):
        if not has_permission(request.user, "view_cashflow"):
            return Response(
                {
                    "type": "permission_denied",
                    "detail": "現金流預測只開放給經理與會計師——這是全公司的資金狀況",
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        params = request.query_params
        granularity = params.get("granularity", "week")
        if granularity not in MAX_PERIODS:
            granularity = "week"

        try:
            periods = int(params.get("periods") or (12 if granularity == "week" else 6))
        except ValueError:
            periods = 12
        # 上限不是為了效能，是為了誠實：看到第 40 週的預測會讓人以為那個數字有意義
        periods = max(1, min(periods, MAX_PERIODS[granularity]))

        certainties = None
        if raw := params.get("certainty"):
            certainties = [c for c in raw.split(",") if c in Certainty.values]

        # active()：未成交與暫停的案子不進預測——那些錢短期內不會動
        projects = scope_projects(Project.objects.active(), request.user)
        if project_id := params.get("project"):
            projects = projects.filter(pk=project_id)

        # D49：經理（與系統管理員）看得到公司現有現金，累計從這個數字起算。
        # 只看單一專案時不加——公司底牌跟單一案子的現金流是兩回事
        opening = None
        if not params.get("project") and has_permission(request.user, "view_cash_balance"):
            from main.apps.payables.models import CashBalance

            opening = CashBalance.get().amount

        data = cashflow_service.forecast(
            list(projects.values_list("pk", flat=True)),
            periods=periods,
            granularity=granularity,
            certainties=certainties,
            opening_balance=opening,
        )
        data["project_count"] = projects.count()
        return Response(data)


class CashBalanceView(APIView):
    """公司現有現金（D49）。GET 讀、PUT 改——**只有經理與系統管理員**。

    填進來的數字會直接成為現金流預測「累計」列的起點。
    """

    permission_classes = [IsAuthenticated]

    def _check(self, request):
        if not has_permission(request.user, "view_cash_balance"):
            return Response(
                {"type": "permission_denied",
                 "detail": "公司現有現金只開放給經理與系統管理員"},
                status=status.HTTP_403_FORBIDDEN,
            )
        return None

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        if denied := self._check(request):
            return denied
        from main.apps.payables.models import CashBalance

        return Response(self._payload(CashBalance.get()))

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    def put(self, request):
        if denied := self._check(request):
            return denied
        from decimal import Decimal, InvalidOperation

        from main.apps.payables.models import CashBalance

        try:
            amount = Decimal(str(request.data.get("amount", "")).replace(",", ""))
        except InvalidOperation:
            return Response(
                {"type": "validation_error", "detail": "金額必須是數字"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        balance = CashBalance.get()
        balance.amount = amount
        balance.note = str(request.data.get("note", ""))[:200]
        balance.updated_by = request.user
        balance.save()

        from main.apps.core.models import ActivityLog
        from main.utils.choices import ActivityCategory

        ActivityLog.record(
            f"公司現有現金更新為 {amount:,.0f} 元",
            ActivityCategory.SYSTEM, actor=request.user, obj=balance,
        )
        return Response(self._payload(balance))

    @staticmethod
    def _payload(balance):
        return {
            "amount": str(balance.amount),
            "note": balance.note,
            "updated_at": balance.updated_at,
            "updated_by_name": balance.updated_by.name if balance.updated_by else "",
        }


class ProjectPnlView(APIView):
    """單一專案的損益：有效合約額 − 該案工程成本。

    專案負責人看得到自己的案子——他要為這個數字負責，
    所以他必須看得到它。
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request, pk):
        project = scope_projects(Project.objects.all(), request.user).filter(pk=pk).first()
        if project is None:
            return Response(
                {"type": "not_found", "detail": "找不到這個專案"},
                status=status.HTTP_404_NOT_FOUND,
            )
        if not can_view_amount(request.user, project):
            return Response(
                {"type": "permission_denied", "detail": "你的角色看不到金額"},
                status=status.HTTP_403_FORBIDDEN,
            )
        return Response(cashflow_service.project_pnl(project))
