from django.db.models import Q
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response

from main.apps.billing.models import BillingClaim, BillingClaimLog, BillingMilestone
from main.apps.billing.serializers import (
    BillingClaimSerializer,
    BillingMilestoneSerializer,
    BillingMilestoneWriteSerializer,
    ClaimLogSerializer,
    ClaimTransitionSerializer,
    ManualClaimSerializer,
)
from main.apps.billing.services import trigger_service
from main.utils.choices import ClaimState, MilestoneState, TriggerType
from main.utils.permissions import has_permission
from main.utils.scoping import scope_billing
from main.utils.viewsets import BaseModelViewSet, bool_param


class BillingMilestoneViewSet(BaseModelViewSet):
    """請款里程碑 —— 合約上寫的那幾條。

    與請款事件（BillingClaim）分兩層，因為 `per_batch` 觸發時
    一條里程碑會產生 N 筆可請款事件。
    """

    queryset = BillingMilestone.objects.select_related(
        "project", "phase", "target_location"
    ).prefetch_related("claims__triggered_by_unit")
    serializer_class = BillingMilestoneSerializer
    write_serializer_class = BillingMilestoneWriteSerializer
    scope_function = staticmethod(scope_billing)
    read_permission = "view_billing"
    write_permission = "edit_milestone"

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if project := params.get("project"):
            qs = qs.filter(project_id=project)
        if state := params.get("state"):
            qs = qs.filter(state__in=state.split(","))
        if bool_param(self.request, "outstanding"):
            qs = qs.exclude(state=MilestoneState.RECEIVED)
        return qs

    def perform_create(self, serializer):
        milestone = serializer.save()
        milestone.recalc_amount()

    def perform_update(self, serializer):
        milestone = serializer.save()
        # 已產生過請款的里程碑，金額不重算——已經送出去的數字不能被改掉
        if not milestone.claims.exists():
            milestone.recalc_amount()

    def perform_destroy(self, instance):
        from main.utils.exceptions import BusinessRuleError

        if instance.claims.exists():
            raise BusinessRuleError("此里程碑已產生請款事件，不可刪除")
        instance.delete()

    @extend_schema(request=ManualClaimSerializer, responses=BillingClaimSerializer)
    @action(detail=True, methods=["post"], url_path="manual-claim")
    def manual_claim(self, request, pk=None):
        """人工建立一筆可請款事件。

        給 `trigger_type = manual` 的里程碑用——有些合約條件系統判不出來
        （如「業主內部簽核完成」），就讓會計自己按。
        """
        if not has_permission(request.user, "edit_milestone"):
            return self._denied("你沒有建立請款事件的權限")

        milestone = self.get_object()
        serializer = ManualClaimSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        from main.utils.exceptions import BusinessRuleError

        amount = serializer.validated_data["amount"]
        remaining = milestone.amount - milestone.claimable_amount
        if amount > remaining:
            raise BusinessRuleError(
                f"金額超過此里程碑剩餘可請金額（{remaining:,.0f} 元）"
            )

        from main.apps.core.models import ActivityLog
        from main.utils.choices import ActivityCategory, ClaimSource

        claim = BillingClaim.objects.create(
            milestone=milestone, amount=amount, source=ClaimSource.MANUAL,
            state=ClaimState.CLAIMABLE, note=serializer.validated_data.get("note", ""),
        )
        BillingClaimLog.objects.create(
            claim=claim, from_state="", to_state=ClaimState.CLAIMABLE,
            is_auto=False, amount_snapshot=amount, changed_by=request.user,
        )
        trigger_service.recalc_milestone(milestone)
        ActivityLog.record(
            f"{milestone.project.name}·{milestone.label} 人工建立請款 {amount:,.0f} 元",
            ActivityCategory.BILLING, actor=request.user, project=milestone.project, obj=claim,
        )
        return Response(
            BillingClaimSerializer(claim, context=self.get_serializer_context()).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"], url_path="unlock-weight-basis")
    def unlock_weight_basis(self, request, pk=None):
        """解鎖已鎖定的重量分母。

        分母是「這期總共幾噸」，分批請款的每一筆金額都由它算出來。
        鎖定後要改，必須綁一張**已核准的變更追加單**——
        這是把「要改就得重簽合約」寫成程式碼（決策 D20）。
        """
        if not has_permission(request.user, "unlock_weight_basis"):
            return self._denied("只有經營者能解鎖重量基數")

        milestone = self.get_object()
        from main.apps.projects.models import ChangeOrder
        from main.utils.choices import ChangeOrderStatus
        from main.utils.exceptions import BusinessRuleError

        co_id = request.data.get("change_order")
        change_order = ChangeOrder.objects.filter(
            pk=co_id, project=milestone.project, status=ChangeOrderStatus.APPROVED
        ).first()
        if change_order is None:
            raise BusinessRuleError(
                "解鎖重量基數必須指定一張【本專案已核准】的變更追加單。"
                "分母變了等於計價方式變了，合約要一起改"
            )

        milestone.weight_basis_kg = None
        milestone.weight_basis_locked_at = None
        milestone.weight_basis_changed_by_co = change_order
        milestone.save(update_fields=[
            "weight_basis_kg", "weight_basis_locked_at", "weight_basis_changed_by_co", "updated_at",
        ])
        return Response({
            "message": f"已解鎖，依變更單「{change_order.title}」。下次觸發時會重新鎖定分母",
            "milestone": BillingMilestoneSerializer(
                milestone, context=self.get_serializer_context()
            ).data,
        })

    @extend_schema(
        responses=OpenApiTypes.OBJECT,
        description="請款設定檢查：逐項告訴使用者還缺什麼、為什麼重要、該去哪裡補",
    )
    @action(detail=False, methods=["get"], url_path="setup-check")
    def setup_check(self, request):
        """請款自動化要能跑，前置條件有五、六項。

        任何一項沒做，結果都是「簽收了但什麼都沒發生」——
        而畫面上看不出是哪裡沒做。這個端點逐項檢查後直接說。
        """
        from main.apps.billing.services import setup_service
        from main.apps.projects.models import Project
        from main.utils.scoping import scope_projects

        visible = scope_projects(Project.objects.filter(is_closed=False), request.user)

        if project_id := request.query_params.get("project"):
            project = visible.filter(pk=project_id).prefetch_related(
                "phases", "units__template__stages", "units__phase"
            ).first()
            if project is None:
                return Response(
                    {"type": "not_found", "detail": "找不到這個專案"},
                    status=status.HTTP_404_NOT_FOUND,
                )
            return Response(setup_service.check(project))

        # 沒指定專案時回簡表：哪幾個案子還沒設定好
        projects = visible.prefetch_related(
            "phases", "units__template__stages", "units__phase"
        )[:20]
        return Response({"projects": setup_service.check_all(projects)})

    @action(detail=False, methods=["get"])
    def summary(self, request):
        """請款總覽：四個狀態各有多少錢。"""
        qs = self.get_queryset()
        claims = BillingClaim.objects.filter(milestone__in=qs)

        def total(state):
            return sum(c.amount for c in claims.filter(state=state))

        pending = sum(
            m.amount - m.claimable_amount for m in qs if m.amount > m.claimable_amount
        )
        return Response({
            "pending": str(pending),
            "claimable": str(total(ClaimState.CLAIMABLE)),
            "invoiced": str(total(ClaimState.INVOICED)),
            "received": str(total(ClaimState.RECEIVED)),
            "claimable_count": claims.filter(state=ClaimState.CLAIMABLE).count(),
            "overdue_claimable": self._overdue_claimable(claims),
        })

    def _overdue_claimable(self, claims):
        """可請款超過 7 天還沒開單的 —— 這是最容易漏掉的錢"""
        from datetime import timedelta

        from django.utils import timezone

        cutoff = timezone.now() - timedelta(days=7)
        overdue = claims.filter(state=ClaimState.CLAIMABLE, claimable_at__lt=cutoff)
        return {"count": overdue.count(), "amount": str(sum(c.amount for c in overdue))}

    def _denied(self, message):
        return Response(
            {"type": "permission_denied", "detail": message},
            status=status.HTTP_403_FORBIDDEN,
        )


class BillingClaimViewSet(BaseModelViewSet):
    """請款事件 —— 實際能開發票的那一筆錢。"""

    queryset = BillingClaim.objects.select_related(
        "milestone__project", "triggered_by_unit"
    )
    serializer_class = BillingClaimSerializer
    read_permission = "view_billing"
    write_permission = "transition_claim"
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        visible = scope_billing(BillingMilestone.objects.all(), self.request.user)
        qs = super().get_queryset().filter(milestone__in=visible)
        params = self.request.query_params
        if project := params.get("project"):
            qs = qs.filter(milestone__project_id=project)
        if state := params.get("state"):
            qs = qs.filter(state__in=state.split(","))
        if milestone := params.get("milestone"):
            qs = qs.filter(milestone_id=milestone)
        if q := params.get("q"):
            qs = qs.filter(
                Q(invoice_no__icontains=q)
                | Q(milestone__label__icontains=q)
                | Q(milestone__project__name__icontains=q)
            )
        return qs

    @extend_schema(request=ClaimTransitionSerializer, responses=BillingClaimSerializer)
    @action(detail=True, methods=["post"])
    def transition(self, request, pk=None):
        """狀態轉換：可請款 → 已請款 → 已收款。

        往回轉（打錯了）必須填原因，並且留在不可竄改的歷程裡——
        錢的狀態被改過而沒人知道，是查帳時最麻煩的事。
        """
        if not has_permission(request.user, "transition_claim"):
            return self._denied("你沒有變更請款狀態的權限")

        claim = self.get_object()
        serializer = ClaimTransitionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        to_state = data["to_state"]

        from django.db import transaction

        from main.utils.exceptions import BusinessRuleError

        ORDER = {ClaimState.CLAIMABLE: 0, ClaimState.INVOICED: 1, ClaimState.RECEIVED: 2}
        is_backward = ORDER[to_state] < ORDER[claim.state]
        if to_state == claim.state:
            raise BusinessRuleError("狀態沒有變化")
        if is_backward and not data.get("reason"):
            raise BusinessRuleError("往回轉必須填寫原因")
        if not is_backward and ORDER[to_state] - ORDER[claim.state] > 1:
            raise BusinessRuleError("不可跳過中間狀態，請依序轉換")

        with transaction.atomic():
            from_state = claim.state
            claim.state = to_state
            if to_state == ClaimState.INVOICED:
                claim.invoice_date = data.get("date") or claim.invoice_date
                if data.get("invoice_no"):
                    claim.invoice_no = data["invoice_no"]
            elif to_state == ClaimState.RECEIVED:
                claim.receive_date = data.get("date") or claim.receive_date
            elif to_state == ClaimState.CLAIMABLE:
                claim.invoice_date = None
                claim.invoice_no = ""
            claim.save()

            BillingClaimLog.objects.create(
                claim=claim, from_state=from_state, to_state=to_state,
                reason=data.get("reason", ""), is_auto=False,
                amount_snapshot=claim.amount, changed_by=request.user,
            )
            trigger_service.recalc_milestone(claim.milestone)

            from main.apps.core.models import ActivityLog
            from main.utils.choices import ActivityCategory

            label = dict(ClaimState.choices)[to_state]
            ActivityLog.record(
                f"{claim.milestone.project.name}·{claim.milestone.label} "
                f"{claim.amount:,.0f} 元 → {label}",
                ActivityCategory.BILLING, actor=request.user,
                project=claim.milestone.project, obj=claim,
            )

        claim.refresh_from_db()
        return Response(
            BillingClaimSerializer(claim, context=self.get_serializer_context()).data
        )

    @action(detail=True, methods=["get"])
    def logs(self, request, pk=None):
        claim = self.get_object()
        logs = BillingClaimLog.objects.filter(claim=claim).select_related("changed_by")
        return Response(ClaimLogSerializer(logs, many=True).data)

    def _denied(self, message):
        return Response(
            {"type": "permission_denied", "detail": message},
            status=status.HTTP_403_FORBIDDEN,
        )


TRIGGER_TYPES = [{"value": v, "label": label} for v, label in TriggerType.choices]
