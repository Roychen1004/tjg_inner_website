from datetime import timedelta

from django.db import transaction
from django.db.models import Q, Sum
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework.decorators import action
from rest_framework.response import Response

from main.apps.billing.models import BillingMilestone, MilestoneLog
from main.apps.billing.serializers import (
    BillingMilestoneSerializer,
    BillingMilestoneWriteSerializer,
    MilestoneLogSerializer,
    MilestoneTransitionSerializer,
)
from main.utils.choices import MilestoneState
from main.utils.exceptions import BusinessRuleError
from main.utils.permissions import has_permission
from main.utils.scoping import scope_billing
from main.utils.viewsets import BaseModelViewSet, bool_param

# 狀態順序。往前一次只能走一步；往回要填原因
STATE_ORDER = {
    MilestoneState.PENDING: 0,
    MilestoneState.CLAIMABLE: 1,
    MilestoneState.INVOICED: 2,
    MilestoneState.RECEIVED: 3,
}


class BillingMilestoneViewSet(BaseModelViewSet):
    """應收款：未到 → 可請款 → 已請款 → 已收款。"""

    queryset = BillingMilestone.objects.select_related(
        "project", "trigger_unit__flow_item", "accountant"
    )
    serializer_class = BillingMilestoneSerializer
    write_serializer_class = BillingMilestoneWriteSerializer
    scope_function = staticmethod(scope_billing)
    read_permission = "view_money"
    write_permission = "edit_milestone"

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if project := params.get("project"):
            qs = qs.filter(project_id=project)
        if state := params.get("state"):
            qs = qs.filter(state__in=state.split(","))
        # 「我的任務」待收款清單：指定給我收的期別（D45）
        if accountant := params.get("accountant"):
            qs = qs.filter(
                accountant=self.request.user if accountant == "me" else accountant
            )
        if bool_param(self.request, "outstanding"):
            qs = qs.exclude(state=MilestoneState.RECEIVED)
        if q := params.get("q"):
            qs = qs.filter(
                Q(invoice_no__icontains=q) | Q(label__icontains=q)
                | Q(project__name__icontains=q)
            )
        return qs

    def perform_create(self, serializer):
        milestone = serializer.save()
        milestone.recalc_amount()

    def perform_update(self, serializer):
        old_trigger = serializer.instance.trigger_unit_id
        milestone = serializer.save()
        milestone.recalc_amount()  # 已請款的列 recalc_amount() 內部自己會跳過
        # D46：取消（或換掉）觸發連結時，還停在「可請款」的狀態要同步退回未到
        if old_trigger and milestone.trigger_unit_id != old_trigger:
            from main.apps.billing.services import trigger_service

            trigger_service.revert_claimable(
                milestone, self.request.user,
                "觸發流程連結被取消，系統自動退回未到",
            )

    def perform_destroy(self, instance):
        if instance.state in (MilestoneState.INVOICED, MilestoneState.RECEIVED):
            raise BusinessRuleError("這筆已經請款，不可刪除。打錯的話先把狀態轉回可請款")
        instance.delete()

    @extend_schema(request=MilestoneTransitionSerializer, responses=BillingMilestoneSerializer)
    @action(detail=True, methods=["post"])
    def transition(self, request, pk=None):
        """狀態轉換。

        往回轉（打錯了）必須填原因，並且留在不可竄改的歷程裡——
        錢的狀態被改過而沒人知道，是查帳時最麻煩的事。
        """
        if not has_permission(request.user, "transition_milestone"):
            return Response(
                {"type": "permission_denied", "detail": "你沒有變更應收款狀態的權限"},
                status=403,
            )

        milestone = self.get_object()
        serializer = MilestoneTransitionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        to_state = data["to_state"]

        is_backward = STATE_ORDER[to_state] < STATE_ORDER[milestone.state]
        if to_state == milestone.state:
            raise BusinessRuleError("狀態沒有變化")
        if is_backward and not data.get("reason"):
            raise BusinessRuleError("往回轉必須填寫原因")
        if not is_backward and STATE_ORDER[to_state] - STATE_ORDER[milestone.state] > 1:
            raise BusinessRuleError("不可跳過中間狀態，請依序轉換")

        with transaction.atomic():
            from_state = milestone.state
            milestone.state = to_state
            if to_state == MilestoneState.CLAIMABLE:
                if is_backward:
                    # 回到可請款＝那張單不算數了，請款資料跟著失效
                    milestone.invoice_date = None
                    milestone.invoice_no = ""
                    milestone.due_date = None
                else:
                    milestone.claimable_at = timezone.now()
            elif to_state == MilestoneState.PENDING:
                milestone.claimable_at = None
            elif to_state == MilestoneState.INVOICED:
                milestone.invoice_date = data.get("date") or milestone.invoice_date
                if data.get("invoice_no"):
                    milestone.invoice_no = data["invoice_no"]
                if is_backward:
                    milestone.receive_date = None
                # 單開出去了，錢哪天到就推得出來——請款日＋客戶帳期。
                # 這是現金流「確定」那一級的來源。使用者填過就不覆蓋
                if milestone.invoice_date and not milestone.due_date:
                    from main.apps.payables.services import terms_service

                    customer = milestone.project.customer
                    milestone.due_date = terms_service.due_date(
                        milestone.invoice_date, customer.payment_term_type,
                        customer.payment_term_days,
                    )
            elif to_state == MilestoneState.RECEIVED:
                milestone.receive_date = data.get("date") or milestone.receive_date
            milestone.save()

            MilestoneLog.objects.create(
                milestone=milestone, from_state=from_state, to_state=to_state,
                reason=data.get("reason", ""), amount_snapshot=milestone.amount,
                changed_by=request.user,
            )

            from main.apps.core.models import ActivityLog
            from main.utils.choices import ActivityCategory

            label = dict(MilestoneState.choices)[to_state]
            ActivityLog.record(
                f"{milestone.project.name}·{milestone.label} {milestone.amount:,.0f} 元 → {label}",
                ActivityCategory.BILLING, actor=request.user,
                project=milestone.project, obj=milestone,
            )

        milestone.refresh_from_db()
        return Response(
            BillingMilestoneSerializer(milestone, context=self.get_serializer_context()).data
        )

    @action(detail=True, methods=["get"])
    def logs(self, request, pk=None):
        milestone = self.get_object()
        logs = MilestoneLog.objects.filter(milestone=milestone).select_related("changed_by")
        return Response(MilestoneLogSerializer(logs, many=True).data)

    @action(detail=False, methods=["get"])
    def summary(self, request):
        """應收總覽：四個狀態各有多少錢，加上「放著沒開單」的提醒。"""
        qs = self.get_queryset()
        agg = qs.aggregate(
            pending=Sum("amount", filter=Q(state=MilestoneState.PENDING)),
            claimable=Sum("amount", filter=Q(state=MilestoneState.CLAIMABLE)),
            invoiced=Sum("amount", filter=Q(state=MilestoneState.INVOICED)),
            received=Sum("amount", filter=Q(state=MilestoneState.RECEIVED)),
        )
        cutoff = timezone.now() - timedelta(days=7)
        overdue = qs.filter(state=MilestoneState.CLAIMABLE, claimable_at__lt=cutoff)
        overdue_amount = overdue.aggregate(total=Sum("amount"))["total"]
        return Response({
            "pending": str(agg["pending"] or 0),
            "claimable": str(agg["claimable"] or 0),
            "invoiced": str(agg["invoiced"] or 0),
            "received": str(agg["received"] or 0),
            "claimable_count": qs.filter(state=MilestoneState.CLAIMABLE).count(),
            # 可請款超過 7 天還沒開單的 —— 這是最容易漏掉的錢
            "overdue_claimable": {
                "count": overdue.count(),
                "amount": str(overdue_amount or 0),
            },
        })
