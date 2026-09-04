from django.db.models import Count, Q
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response

from main.apps.payables.models import Payable, PayableLog, Subcontract
from main.apps.payables.serializers import (
    PayableLogSerializer,
    PayableSerializer,
    PayableTransitionSerializer,
    PayableWriteSerializer,
    SubcontractSerializer,
    SubcontractWriteSerializer,
)
from main.utils.choices import (
    PayableState,
    PaymentMethod,
    PaymentTermType,
    SubcontractCategory,
    SubcontractStatus,
)
from main.utils.exceptions import BusinessRuleError
from main.utils.permissions import has_permission
from main.utils.scoping import scope_payables
from main.utils.viewsets import BaseModelViewSet


class SubcontractViewSet(BaseModelViewSet):
    """分包合約

    回答的問題：「這個案子我們要付給誰、多少、什麼時候付」。
    """

    queryset = Subcontract.objects.select_related("project", "vendor")
    serializer_class = SubcontractSerializer
    write_serializer_class = SubcontractWriteSerializer
    scope_function = staticmethod(scope_payables)
    read_permission = "view_payables"
    write_permission = "edit_subcontract"

    def get_queryset(self):
        qs = super().get_queryset().with_billed().annotate(
            payable_count=Count("payables", distinct=True)
        )
        params = self.request.query_params
        if project := params.get("project"):
            qs = qs.filter(project_id=project)
        if vendor := params.get("vendor"):
            qs = qs.filter(vendor_id=vendor)
        if category := params.get("category"):
            qs = qs.filter(category__in=category.split(","))
        if state := params.get("status"):
            qs = qs.filter(status__in=state.split(","))
        if q := params.get("q"):
            qs = qs.filter(
                Q(code__icontains=q) | Q(title__icontains=q) | Q(vendor__name__icontains=q)
            )
        # annotate 會產生 GROUP BY，Django 就不再套用 Meta.ordering，
        # 分頁會在頁與頁之間跳號。明寫排序
        return qs.order_by("-created_at")

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def perform_destroy(self, instance):
        if instance.payables.exists():
            raise BusinessRuleError(
                "這張合約底下已有應付款項，不可刪除。若要停用，把狀態改成「已結案」"
            )
        instance.delete()


class PayableViewSet(BaseModelViewSet):
    """應付款項

    跟應收款對稱：狀態往前推、往回轉要填原因、
    每一步留不可竄改的歷程。
    """

    queryset = Payable.objects.select_related(
        "project", "vendor", "subcontract", "flow_unit__flow_item"
    ).prefetch_related("lines__item")   # D52 明細
    serializer_class = PayableSerializer
    write_serializer_class = PayableWriteSerializer
    scope_function = staticmethod(scope_payables)
    read_permission = "view_payables"
    write_permission = "edit_payable"

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if project := params.get("project"):
            qs = qs.filter(project_id=project)
        if subcontract := params.get("subcontract"):
            qs = qs.filter(subcontract_id=subcontract)
        if flow_unit := params.get("flow_unit"):
            qs = qs.filter(flow_unit_id=flow_unit)
        if vendor := params.get("vendor"):
            qs = qs.filter(vendor_id=vendor)
        if state := params.get("state"):
            qs = qs.filter(state__in=state.split(","))
        if category := params.get("category"):
            qs = qs.filter(category__in=category.split(","))
        if params.get("overdue") == "true":
            from django.utils import timezone

            qs = qs.exclude(state=PayableState.PAID).filter(due_date__lt=timezone.localdate())
        if q := params.get("q"):
            qs = qs.filter(
                Q(title__icontains=q)
                | Q(vendor__name__icontains=q)
                | Q(invoice_no__icontains=q)
                | Q(project__name__icontains=q)
            )
        return qs

    def perform_create(self, serializer):
        payable = serializer.save(created_by=self.request.user)
        PayableLog.objects.create(
            payable=payable, from_state="", to_state=payable.state,
            amount_snapshot=payable.payable_amount, changed_by=self.request.user,
        )
        self._log_activity(payable, f"登錄計價 {payable.payable_amount:,.0f} 元")

    def perform_destroy(self, instance):
        if instance.state != PayableState.PENDING:
            raise BusinessRuleError(
                f"已「{instance.get_state_display()}」的款項不可刪除。"
                "若金額有誤，請往回轉狀態並填寫原因，留下軌跡"
            )
        instance.delete()

    @extend_schema(request=PayableTransitionSerializer, responses=PayableSerializer)
    @action(detail=True, methods=["post"])
    def transition(self, request, pk=None):
        """狀態轉換：待計價 → 已核可 → 已付款。

        兩道權限刻意分開（職能分離）：
          · `approve_payable` 決定「這筆該不該付、付多少」——只有經理
          · `pay_payable`     執行付款並登錄——經理與會計
        """
        payable = self.get_object()
        serializer = PayableTransitionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        to_state = data["to_state"]

        ORDER = {PayableState.PENDING: 0, PayableState.APPROVED: 1, PayableState.PAID: 2}
        if to_state == payable.state:
            raise BusinessRuleError("狀態沒有變化")

        # ★ 權限先於業務規則。反過來的話，沒有權限的人會收到
        # 「往回轉必須填原因」——等於告訴他「填了原因就能過」，而其實不能
        touches_paid = PayableState.PAID in (to_state, payable.state)
        required = "pay_payable" if touches_paid else "approve_payable"
        if not has_permission(request.user, required):
            message = (
                "只有會計師與經理能登錄付款"
                if required == "pay_payable"
                else "只有經理能核可付款——核可與付款分開，"
                     "同一個人不該既決定要付多少、又執行付款"
            )
            return Response(
                {"type": "permission_denied", "detail": message},
                status=status.HTTP_403_FORBIDDEN,
            )

        is_backward = ORDER[to_state] < ORDER[payable.state]
        if not is_backward and ORDER[to_state] - ORDER[payable.state] > 1:
            raise BusinessRuleError("不可跳過中間狀態，請依序轉換")
        if is_backward and not data.get("reason"):
            raise BusinessRuleError("往回轉必須填寫原因")

        from django.db import transaction
        from django.utils import timezone

        # 付款日不能早於計價日。DB 有 CHECK 擋著，但那會變成 500——
        # 使用者只看到「系統發生錯誤」，不知道自己填錯了哪一格
        if to_state == PayableState.PAID:
            paid_on = data.get("date") or timezone.localdate()
            if payable.billing_date and paid_on < payable.billing_date:
                raise BusinessRuleError(
                    f"付款日 {paid_on} 早於計價日 {payable.billing_date}。"
                    "錢不會在包商送單之前就付出去——請確認日期"
                )

        with transaction.atomic():
            from_state = payable.state
            payable.state = to_state
            if to_state == PayableState.APPROVED:
                payable.approved_at = timezone.now()
                payable.approved_by = request.user
            elif to_state == PayableState.PAID:
                payable.paid_date = data.get("date") or timezone.localdate()
                if data.get("payment_method"):
                    payable.payment_method = data["payment_method"]
                if data.get("check_due_date"):
                    payable.check_due_date = data["check_due_date"]
                if data.get("check_no"):
                    payable.check_no = data["check_no"]
            elif to_state == PayableState.PENDING:
                payable.approved_at = None
                payable.approved_by = None
            if from_state == PayableState.PAID:
                payable.paid_date = None
            payable.save()

            PayableLog.objects.create(
                payable=payable, from_state=from_state, to_state=to_state,
                reason=data.get("reason", ""), amount_snapshot=payable.payable_amount,
                changed_by=request.user,
            )
            self._log_activity(
                payable, f"{payable.payable_amount:,.0f} 元 → {payable.get_state_display()}"
            )

        payable.refresh_from_db()
        return Response(PayableSerializer(payable, context=self.get_serializer_context()).data)

    @action(detail=True, methods=["get"])
    def logs(self, request, pk=None):
        payable = self.get_object()
        rows = PayableLog.objects.filter(payable=payable).select_related("changed_by")
        return Response(PayableLogSerializer(rows, many=True).data)

    @extend_schema(responses=OpenApiTypes.OBJECT)
    @action(detail=False, methods=["get"])
    def summary(self, request):
        """三個狀態各有多少錢，以及逾期未付的。"""
        from django.db.models import Sum
        from django.utils import timezone

        qs = self.get_queryset()
        by_state = {
            row["state"]: row["total"]
            for row in qs.values("state").annotate(total=Sum("payable_amount"))
        }
        overdue = (
            qs.exclude(state=PayableState.PAID)
            .filter(due_date__lt=timezone.localdate())
            .aggregate(total=Sum("payable_amount"), count=Count("id"))
        )
        return Response({
            "pending": str(by_state.get(PayableState.PENDING, 0)),
            "approved": str(by_state.get(PayableState.APPROVED, 0)),
            "paid": str(by_state.get(PayableState.PAID, 0)),
            "overdue": {
                "count": overdue["count"] or 0,
                "amount": str(overdue["total"] or 0),
            },
        })

    def _log_activity(self, payable, text):
        from main.apps.core.models import ActivityLog
        from main.utils.choices import ActivityCategory

        ActivityLog.record(
            f"{payable.vendor.name}·{payable.title} {text}",
            ActivityCategory.BILLING, actor=self.request.user,
            project=payable.project, obj=payable,
        )


# 給前端下拉用。列舉值在後端定義，前端不重抄一份中文標籤
PAYABLE_OPTIONS = {
    "subcontract_categories": [
        {"value": v, "label": label} for v, label in SubcontractCategory.choices
    ],
    "payment_term_types": [{"value": v, "label": label} for v, label in PaymentTermType.choices],
    "payment_methods": [{"value": v, "label": label} for v, label in PaymentMethod.choices],
    "payable_states": [{"value": v, "label": label} for v, label in PayableState.choices],
    "subcontract_statuses": [
        {"value": v, "label": label} for v, label in SubcontractStatus.choices
    ],
}


from .cashflow import (  # noqa: E402
    CashBalanceView,
    CashflowForecastView,
    CashLedgerView,
    ProjectPnlView,
)

__all__ = [
    "CashBalanceView", "CashflowForecastView", "CashLedgerView", "PAYABLE_OPTIONS",
    "PayableViewSet", "ProjectPnlView", "SubcontractViewSet",
]
