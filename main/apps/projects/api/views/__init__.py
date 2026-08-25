from urllib.parse import quote

from django.db.models import Count, Q
from django.http import HttpResponse
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response

from main.apps.projects.models import ChangeOrder, Project
from main.apps.projects.serializers import (
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
        "customer", "owner"
    ).prefetch_related("flow_units__flow_item__stage")
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
        if lc := params.get("lifecycle"):
            qs = qs.filter(lifecycle__in=lc.split(","))
        if owner := params.get("owner"):
            qs = qs.filter(owner_id=owner)

        closed = bool_param(self.request, "closed")
        if closed is not None:
            qs = qs.filter(is_closed=closed)
        elif self.action == "list" and not params.get("lifecycle"):
            # 預設不顯示已結案——首頁要回答「現在有什麼在跑」。
            # 明選了生命週期（含「已結案」）就以那個為準，不再疊預設
            qs = qs.filter(is_closed=False)

        # annotate() 會產生 GROUP BY，Django 就不再認得 Meta.ordering，
        # 分頁結果可能在頁與頁之間跳號。明寫排序。
        return qs.order_by("-created_at")

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx["request"] = self.request
        return ctx

    def destroy(self, request, *args, **kwargs):
        # 刪專案是拍板的事——會計有 edit_project（一般寫入權），但刪除只有經理能按
        from main.utils.permissions import has_permission

        if not has_permission(request.user, "delete_project"):
            return Response(
                {"type": "permission_denied", "detail": "只有經理能刪除專案"},
                status=status.HTTP_403_FORBIDDEN,
            )
        return super().destroy(request, *args, **kwargs)

    def perform_destroy(self, instance):
        """整案連流程單元、構件批次、應收分期、變更單一起刪（CASCADE）。

        兩道防線：
          · 已請款／已收款的案子不能刪——錢的歷程不可竄改（鐵律 5），
            建錯的案子改生命週期（未成交／已結案）就好
          · 掛著分包合約或應付款的不能刪（FK PROTECT，先給人話）
        附件另外清：GenericFK 不會跟著 CASCADE，不清會留孤兒檔案。
        """
        from main.utils.choices import MilestoneState
        from main.utils.exceptions import BusinessRuleError

        if instance.milestones.filter(
            state__in=[MilestoneState.INVOICED, MilestoneState.RECEIVED]
        ).exists():
            raise BusinessRuleError(
                "此專案已有請款或收款紀錄，不能刪除。"
                "建錯或沒成交的案子，請到「編輯專案」把案件狀態改成未成交或已結案"
            )
        if instance.subcontracts.exists() or instance.payables.exists():
            raise BusinessRuleError(
                "此專案掛著分包合約或應付款，不能刪除。請先到「金流 → 應付」處理"
            )
        self._delete_attachments(instance)
        instance.delete()

    @staticmethod
    def _delete_attachments(project):
        from django.contrib.contenttypes.models import ContentType

        from main.apps.billing.models import BillingMilestone
        from main.apps.core.models import Attachment
        from main.apps.tracking.models import FlowUnit, TrackingUnit

        targets = [
            (Project, [project.pk]),
            (FlowUnit, list(project.flow_units.values_list("pk", flat=True))),
            (TrackingUnit, list(project.units.values_list("pk", flat=True))),
            (BillingMilestone, list(project.milestones.values_list("pk", flat=True))),
        ]
        for model, ids in targets:
            if not ids:
                continue
            ct = ContentType.objects.get_for_model(model)
            for attachment in Attachment.objects.filter(content_type=ct, object_id__in=ids):
                attachment.delete()  # 連磁碟上的檔案一起刪，不留孤兒

    @extend_schema(request=None, responses=ProjectDetailSerializer)
    @action(detail=True, methods=["post"], url_path="set-flows")
    def set_flows(self, request, pk=None):
        """調整這個案子勾了哪些流程。body：{"flow_items": [id, ...]}

        · 新勾的 → 生一張流程單元
        · 取消勾的 → 未開始且沒附件就刪；有紀錄的改標「不適用」（歷史要留）
        · 重新勾回「不適用」的 → 還原成未開始
        順序永遠是目錄的順序，這裡收到什麼順序都一樣。
        """
        from main.utils.permissions import has_permission

        if not has_permission(request.user, "edit_project"):
            return Response(
                {"type": "permission_denied", "detail": "你沒有編輯專案流程的權限"},
                status=status.HTTP_403_FORBIDDEN,
            )

        project = self.get_object()
        result = project_service.set_flows(
            project, request.data.get("flow_items", []), request.user
        )
        project.refresh_from_db()
        return Response({
            "project": ProjectDetailSerializer(
                project, context=self.get_serializer_context()
            ).data,
            **result,
        })

    @extend_schema(responses=OpenApiTypes.BINARY)
    @action(detail=True, methods=["get"], url_path="gantt-xlsx")
    def gantt_xlsx(self, request, pk=None):
        """下載這個案子的甘特圖 Excel。

        ?variant=progress（預設）＝內部進度追蹤；?variant=plan＝簽約前
        給業主看的工期規劃（無進度/狀態/負責人與圖例）。
        左邊是流程清單、右邊是日期網格著色，視覺規則跟網頁一致。
        看得到案子就能下載（金額不在這張表裡，不用另外限權限）。
        """
        from main.apps.projects.services import gantt_export

        variant = request.query_params.get("variant", "progress")
        if variant not in ("progress", "plan"):
            return Response(
                {"type": "validation_error", "detail": "variant 只能是 progress 或 plan"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        project = self.get_object()
        content = gantt_export.build_xlsx(project, variant)
        response = HttpResponse(
            content,
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        quoted = quote(gantt_export.filename(project, variant))
        response["Content-Disposition"] = f"attachment; filename*=UTF-8''{quoted}"
        return response

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
        """核准變更單。只有經理能按（決策：牽涉合約金額）。"""
        from main.utils.permissions import has_permission

        if not has_permission(request.user, "approve_change_order"):
            return Response(
                {"type": "permission_denied", "detail": "只有經理能核准變更追加單"},
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
