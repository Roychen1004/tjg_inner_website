from django.db.models import Count, Q
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response

from main.apps.projects.models import ChangeOrder, Project
from main.apps.projects.serializers import (
    AdvanceStageSerializer,
    ChangeOrderSerializer,
    ChangeOrderWriteSerializer,
    ProjectDetailSerializer,
    ProjectListSerializer,
    ProjectWriteSerializer,
)
from main.apps.projects.services import project_service
from main.utils.choices import Status
from main.utils.scoping import can_view_amount, scope_projects
from main.utils.viewsets import BaseModelViewSet, bool_param


class ProjectViewSet(BaseModelViewSet):
    """專案

    回答的問題：「這個案子進行到哪、還剩多少沒收」。
    """

    queryset = Project.objects.select_related(
        "customer", "owner", "main_stage", "main_template"
    ).prefetch_related("main_template__stages")
    serializer_class = ProjectListSerializer
    detail_serializer_class = ProjectDetailSerializer
    write_serializer_class = ProjectWriteSerializer
    scope_function = staticmethod(scope_projects)
    read_permission = None  # 登入即可看案子；金額由序列化器過濾
    write_permission = "edit_project"
    search_fields = ["code", "name"]

    def get_queryset(self):
        qs = super().get_queryset()

        # 計數與金額都在 SQL 裡算完，不要每筆專案再打一次 DB
        qs = qs.with_amounts().annotate(
            unit_count=Count("units", distinct=True),
            attention_count=Count(
                "units",
                filter=Q(units__status__in=[Status.ATRISK, Status.DELAYED]),
                distinct=True,
            ),
        )

        params = self.request.query_params
        if q := params.get("q"):
            qs = qs.filter(Q(code__icontains=q) | Q(name__icontains=q) | Q(customer__name__icontains=q))
        if pt := params.get("type"):
            qs = qs.filter(project_type=pt)
        if st := params.get("status"):
            qs = qs.filter(status=st)
        if owner := params.get("owner"):
            qs = qs.filter(owner_id=owner)

        closed = bool_param(self.request, "closed")
        if closed is not None:
            qs = qs.filter(is_closed=closed)
        elif self.action == "list":
            # 預設不顯示已結案——首頁要回答「現在有什麼在跑」
            qs = qs.filter(is_closed=False)

        # annotate() 會產生 GROUP BY，Django 就不再認得 Meta.ordering，
        # 分頁結果可能在頁與頁之間跳號。明寫排序。
        return qs.order_by("-created_at")

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx["request"] = self.request
        return ctx

    def perform_destroy(self, instance):
        from main.utils.exceptions import BusinessRuleError

        if instance.units.exists():
            raise BusinessRuleError("此專案底下還有追蹤單元，請先刪除或轉移後再刪除專案")
        instance.delete()

    @extend_schema(request=AdvanceStageSerializer, responses=ProjectDetailSerializer)
    @action(detail=True, methods=["post"], url_path="advance-stage")
    def advance_stage(self, request, pk=None):
        """推進／回退專案主線。

        推進到結案且尚有未收款時回 409，body 帶著具體金額——
        前端顯示「尚有 N 筆合計 X 元未收款，確定結案？」再帶 confirmed=true 重送。
        """
        from main.utils.permissions import has_permission

        if not has_permission(request.user, "edit_project"):
            return Response(
                {"type": "permission_denied", "detail": "你沒有推進專案階段的權限"},
                status=status.HTTP_403_FORBIDDEN,
            )

        project = self.get_object()
        serializer = AdvanceStageSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        project, warnings = project_service.advance_main_stage(
            project.pk,
            serializer.validated_data["direction"],
            request.user,
            note=serializer.validated_data.get("note", ""),
            confirmed=str(request.data.get("confirmed", "")).lower() in ("true", "1"),
        )
        project.refresh_from_db()
        data = ProjectDetailSerializer(project, context=self.get_serializer_context()).data
        return Response({"project": data, "warnings": warnings})

    @action(detail=True, methods=["get"])
    def summary(self, request, pk=None):
        """一個案子的全貌：階段分布、狀態分布、收款進度、待簽收。

        給專案明細頁一次取完，不用前端打五個 API 再自己算。
        """
        project = self.get_object()
        units = project.units.select_related("current_stage")

        by_stage = {}
        for unit in units:
            key = unit.current_stage.name
            by_stage.setdefault(key, {"name": key, "seq": unit.current_stage.seq, "count": 0})
            by_stage[key]["count"] += 1

        counts = units.aggregate(
            total=Count("id"),
            ontrack=Count("id", filter=Q(status=Status.ONTRACK)),
            atrisk=Count("id", filter=Q(status=Status.ATRISK)),
            delayed=Count("id", filter=Q(status=Status.DELAYED)),
        )

        payload = {
            "unit_counts": counts,
            "by_stage": sorted(by_stage.values(), key=lambda s: s["seq"]),
            "avg_completion": round(
                sum(u.completion_ratio for u in units) / len(units), 1
            ) if units else 0.0,
        }

        if can_view_amount(request.user, project):
            from django.db.models import Sum

            from main.utils.choices import MilestoneState

            agg = project.milestones.aggregate(
                total=Count("id"),
                claimable=Sum("amount", filter=Q(state=MilestoneState.CLAIMABLE)),
                invoiced=Sum("amount", filter=Q(state=MilestoneState.INVOICED)),
            )
            payload["billing"] = {
                "contract_amount": str(project.effective_amount),
                "claimable": str(agg["claimable"] or 0),
                "invoiced": str(agg["invoiced"] or 0),
                "received": str(project.received_amount),
                "collection_rate": project.collection_rate,
                "milestone_count": agg["total"],
            }
        else:
            payload["billing"] = None
        return Response(payload)


class ChangeOrderViewSet(BaseModelViewSet):
    """變更追加單。

    核准後有效合約額改變，尚未請款的里程碑金額會自動重算。
    """

    queryset = ChangeOrder.objects.select_related("project", "approved_by")
    serializer_class = ChangeOrderSerializer
    write_serializer_class = ChangeOrderWriteSerializer
    read_permission = None  # 登入即可看案子；金額由序列化器過濾
    write_permission = "edit_project"

    def get_queryset(self):
        # 變更單的可見範圍跟著專案走——看不到那個案子就看不到它的變更單
        qs = super().get_queryset().filter(
            project__in=scope_projects(Project.objects.all(), self.request.user)
        )
        if project := self.request.query_params.get("project"):
            qs = qs.filter(project_id=project)
        return qs

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        """核准變更單。只有經營者能按（決策：牽涉合約金額）。"""
        from main.utils.permissions import has_permission

        if not has_permission(request.user, "approve_change_order"):
            return Response(
                {"type": "permission_denied", "detail": "只有經營者能核准變更追加單"},
                status=status.HTTP_403_FORBIDDEN,
            )
        change_order = self.get_object()
        change_order, recalculated = project_service.approve_change_order(change_order, request.user)
        return Response({
            "change_order": ChangeOrderSerializer(
                change_order, context=self.get_serializer_context()
            ).data,
            "message": f"已核准，並重算 {recalculated} 筆尚未請款的里程碑金額",
        })
