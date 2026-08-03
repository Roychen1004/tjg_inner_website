from django.db.models import Count, Q
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response

from main.apps.masters.models import Stage, StageTemplate
from main.apps.masters.serializers import StageSerializer, StageTemplateSerializer
from main.apps.tracking.models import ProgressLog, TrackingUnit, TrackingUnitStageLog
from main.apps.tracking.serializers import (
    MoveStageSerializer,
    ProgressLogSerializer,
    ReportProgressSerializer,
    SignoffSerializer,
    StageLogSerializer,
    TrackingUnitCardSerializer,
    TrackingUnitDetailSerializer,
    TrackingUnitWriteSerializer,
)
from main.apps.tracking.services import stage_service
from main.utils.choices import StageDirection, Status, TemplateAppliesTo, UnitType
from main.utils.pagination import SmallPagination
from main.utils.permissions import has_permission
from main.utils.scoping import scope_tracking_units
from main.utils.viewsets import BaseModelViewSet, bool_param

CARD_SELECT = ("project", "phase", "current_stage", "template", "assignee")


class TrackingUnitViewSet(BaseModelViewSet):
    """追蹤單元 —— 構件批次與土建工項共用一組端點。

    「一張表吃兩種業務」的成果：前端只有一套看板程式，
    走哪條流程由 `stage_template` 決定，不是由 if/else 決定。
    """

    queryset = TrackingUnit.objects.select_related(*CARD_SELECT).prefetch_related(
        "template__stages"
    )
    serializer_class = TrackingUnitCardSerializer
    detail_serializer_class = TrackingUnitDetailSerializer
    write_serializer_class = TrackingUnitWriteSerializer
    scope_function = staticmethod(scope_tracking_units)
    read_permission = "view_tracking"
    write_permission = "edit_tracking"

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params

        if q := params.get("q"):
            qs = qs.filter(Q(code__icontains=q) | Q(name__icontains=q) | Q(project__name__icontains=q))
        if project := params.get("project"):
            qs = qs.filter(project_id=project)
        if phase := params.get("phase"):
            qs = qs.filter(phase_id=phase)
        if unit_type := params.get("unit_type"):
            qs = qs.filter(unit_type=unit_type)
        if stage := params.get("stage"):
            qs = qs.filter(current_stage_id=stage)
        if st := params.get("status"):
            qs = qs.filter(status__in=st.split(","))
        if assignee := params.get("assignee"):
            qs = qs.filter(assignee_id=assignee)

        if bool_param(self.request, "awaiting_signoff"):
            qs = qs.filter(current_stage__requires_signoff=True, signoff_date__isnull=True)
        if bool_param(self.request, "attention"):
            qs = qs.filter(status__in=[Status.ATRISK, Status.DELAYED])
        if bool_param(self.request, "mine"):
            qs = qs.filter(assignee=self.request.user)

        return qs

    # ── 看板 ───────────────────────────────────────────────────────
    @action(detail=False, methods=["get"])
    def board(self, request):
        """看板資料：階段軌道 ＋ 每一欄的卡片。

        刻意**不分頁**，但改用兩道硬限制守住記憶體：
          · 必須指定 project 或 unit_type（不讓人一次撈全公司）
          · 單次最多 300 張卡，超過回傳計數並要求縮小範圍

        原因：看板的意義就是「一眼看完」，分頁的看板沒有意義；
        但無上限查詢在 8GB 主機上是不能開的門（決策 D07）。
        """
        params = request.query_params
        project_id = params.get("project")
        unit_type = params.get("unit_type")

        if not project_id and not unit_type:
            return Response(
                {
                    "type": "validation_error",
                    "detail": "看板必須指定專案或追蹤單元類型",
                    "hint": "帶上 ?project=<id> 或 ?unit_type=batch",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        qs = self.filter_queryset(self.get_queryset())
        total = qs.count()
        LIMIT = 300
        truncated = total > LIMIT
        units = list(qs.order_by("current_stage__seq", "-updated_at")[:LIMIT])

        # ★ 每條流程各一個看板。
        #
        # 混合案同時有鋼構（9 站）與土建（5 站），欄位根本不一樣。
        # 硬畫成一個看板只能挑一條當主軌道，另一種全部擠進「其他流程」那一欄——
        # 而位置正是看板唯一的重點，擠在一起就什麼都看不出來了。
        cards = TrackingUnitCardSerializer(
            units, many=True, context=self.get_serializer_context()
        ).data
        card_by_id = {c["id"]: c for c in cards}

        grouped = {}
        for unit in units:
            grouped.setdefault(unit.template_id, []).append(card_by_id[unit.pk])

        templates = {
            t.pk: t
            for t in StageTemplate.objects.filter(pk__in=grouped).prefetch_related("stages")
        } if grouped else {}

        boards = [
            self._build_board(templates[tid], group)
            for tid, group in sorted(grouped.items(), key=lambda kv: -len(kv[1]))
            if tid in templates
        ]

        # 沒有資料時也要畫出空的軌道，否則使用者不知道流程長什麼樣
        if not boards:
            empty = self._default_template(unit_type)
            if empty:
                boards = [self._build_board(empty, [])]

        return Response({
            "boards": boards,
            "total": total,
            "shown": len(units),
            "truncated": truncated,
            "truncated_hint": (
                f"共 {total} 筆，僅顯示前 {LIMIT} 筆。請用專案或期別縮小範圍" if truncated else None
            ),
        })

    @staticmethod
    def _build_board(template, cards):
        stages = sorted(
            (s for s in template.stages.all() if s.is_active), key=lambda s: s.seq
        )
        by_stage = {s.pk: [] for s in stages}
        for card in cards:
            by_stage.setdefault(card["stage_id"], []).append(card)
        return {
            "template": StageTemplateSerializer(template).data,
            "count": len(cards),
            "columns": [
                {
                    "stage": StageSerializer(s).data,
                    "count": len(by_stage[s.pk]),
                    "units": by_stage[s.pk],
                }
                for s in stages
            ],
        }

    @staticmethod
    def _default_template(unit_type):
        applies = (
            TemplateAppliesTo.CIVIL_WORK_ITEM
            if unit_type == UnitType.WORK_ITEM
            else TemplateAppliesTo.STEEL_BATCH
        )
        return StageTemplate.objects.prefetch_related("stages").filter(
            applies_to=applies, is_default=True
        ).first()

    # ── 我的工作 ───────────────────────────────────────────────────
    @action(detail=False, methods=["get"], url_path="my-work", pagination_class=SmallPagination)
    def my_work(self, request):
        """指派給我的工作，依急迫性排序。

        排序不是給人選的——現場人員打開手機就該看到「最該做的那一件」在最上面。
        順序：延誤 → 注意 → 正常；同級內停滯久的在前。
        """
        qs = scope_tracking_units(
            TrackingUnit.objects.select_related(*CARD_SELECT)
            .prefetch_related("template__stages")
            .filter(assignee=request.user),
            request.user,
        )
        # 走到最後一站又做完了的不再出現，否則清單永遠清不掉
        pending = [u for u in qs if not (u.is_complete and not u.can_advance)]

        units = sorted(
            pending,
            key=lambda u: (
                {Status.DELAYED: 0, Status.ATRISK: 1, Status.ONTRACK: 2}.get(u.status, 3),
                -u.days_in_stage,
            ),
        )
        data = TrackingUnitCardSerializer(
            units, many=True, context=self.get_serializer_context()
        ).data
        return Response({
            "count": len(data),
            "results": data,
            "summary": {
                "delayed": sum(1 for u in units if u.status == Status.DELAYED),
                "atrisk": sum(1 for u in units if u.status == Status.ATRISK),
                "awaiting_signoff": sum(1 for u in units if u.is_awaiting_signoff),
            },
        })

    # ── 操作 ───────────────────────────────────────────────────────
    @extend_schema(request=MoveStageSerializer)
    @action(detail=True, methods=["post"], url_path="move-stage")
    def move_stage(self, request, pk=None):
        """推進或回退一個階段。

        回傳副作用（觸發請款、需要簽收、狀態變更）——
        前端據此顯示「已觸發第一期請款 210 萬」之類的提示，
        而不是讓使用者按完之後不知道發生了什麼。
        """
        if not has_permission(request.user, "move_stage"):
            return self._denied("你沒有推進階段的權限")

        unit = self.get_object()
        serializer = MoveStageSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        direction = (
            StageDirection.FORWARD if data["direction"] == "forward" else StageDirection.BACKWARD
        )
        result = stage_service.move_stage(
            unit.pk, direction, request.user,
            note=data.get("note", ""),
            reason_category=data.get("reason_category", ""),
            expected_stage_id=data.get("expected_stage_id"),
        )
        result.unit.refresh_from_db()
        return Response({
            "unit": TrackingUnitDetailSerializer(
                result.unit, context=self.get_serializer_context()
            ).data,
            "warnings": result.warnings,
            "next_action": result.next_action,
            "status_changed": result.status_changed,
        })

    @extend_schema(request=SignoffSerializer)
    @action(detail=True, methods=["post"])
    def signoff(self, request, pk=None):
        """登錄進場簽收 —— 這是觸發請款的動作。

        與推進階段分開：進入「進場簽收」是我們的動作，
        簽收是業主的動作。分開後，「已送到但沒簽」的批次會堆在看板上，
        請款卡在哪一眼看見（決策 D12／D13）。
        """
        if not has_permission(request.user, "record_signoff"):
            return self._denied("你沒有登錄簽收的權限")

        unit = self.get_object()
        serializer = SignoffSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        location = None
        if data.get("signoff_location"):
            from main.apps.inventory.models import Location

            location = Location.objects.filter(pk=data["signoff_location"]).first()

        unit, trigger, warnings = stage_service.record_signoff(
            unit.pk, request.user,
            signoff_date=data.get("signoff_date"),
            signoff_by_name=data["signoff_by_name"],
            signoff_doc_no=data.get("signoff_doc_no", ""),
            signoff_location=location,
        )
        unit.refresh_from_db()

        billing = {
            "triggered": trigger.triggered,
            "reason": trigger.reason,
            "progress_text": trigger.progress_text,
        }
        # 沒有看金額權限的人只知道「觸發了」，不知道多少錢
        if trigger.claim and has_permission(request.user, "view_amounts"):
            billing["claim"] = {
                "id": trigger.claim.pk,
                "amount": str(trigger.claim.amount),
                "milestone": trigger.milestone.label,
            }
        return Response({
            "unit": TrackingUnitDetailSerializer(
                unit, context=self.get_serializer_context()
            ).data,
            "billing": billing,
            "warnings": warnings,
        })

    @extend_schema(request=ReportProgressSerializer)
    @action(detail=True, methods=["post"], url_path="report-progress")
    def report_progress(self, request, pk=None):
        """回報進度。

        用 delta（+5）而不是絕對值——兩個師傅同時回報 +5 會正確加 10；
        用絕對值的話後者會覆蓋前者，少算 5 支。
        """
        if not has_permission(request.user, "report_progress"):
            return self._denied("你沒有回報進度的權限")

        unit = self.get_object()
        serializer = ReportProgressSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        unit, log, suggestion = stage_service.report_progress(
            unit.pk, request.user,
            qty_done=data.get("qty_done"),
            delta=data.get("delta"),
            progress_pct=data.get("progress_pct"),
            note=data.get("note", ""),
        )
        unit.refresh_from_db()
        return Response({
            "unit": TrackingUnitDetailSerializer(
                unit, context=self.get_serializer_context()
            ).data,
            "log": ProgressLogSerializer(log).data,
            "suggestion": suggestion,
        })

    # ── 歷程 ───────────────────────────────────────────────────────
    @action(detail=True, methods=["get"], url_path="stage-logs")
    def stage_logs(self, request, pk=None):
        unit = self.get_object()
        logs = TrackingUnitStageLog.objects.filter(unit=unit).select_related("moved_by")
        return Response(StageLogSerializer(logs, many=True).data)

    @action(detail=True, methods=["get"], url_path="progress-logs")
    def progress_logs(self, request, pk=None):
        unit = self.get_object()
        logs = ProgressLog.objects.filter(unit=unit).select_related("reported_by")[:50]
        return Response(ProgressLogSerializer(logs, many=True).data)

    @action(detail=False, methods=["get"], url_path="stage-options")
    def stage_options(self, request):
        """篩選器用的階段清單。只回 id/name/seq，不分頁——這是下拉選單，本來就短。"""
        applies = request.query_params.get("applies_to")
        qs = Stage.objects.filter(is_active=True, template__is_active=True)
        if applies:
            qs = qs.filter(template__applies_to=applies)
        qs = qs.select_related("template").order_by("template__code", "seq")
        return Response([
            {
                "id": s.pk, "name": s.name, "seq": s.seq,
                "template": s.template.name, "applies_to": s.template.applies_to,
                "requires_signoff": s.requires_signoff,
                "is_billing_trigger": s.is_billing_trigger,
            }
            for s in qs
        ])

    def _denied(self, message):
        return Response(
            {"type": "permission_denied", "detail": message},
            status=status.HTTP_403_FORBIDDEN,
        )


class StageTemplateViewSet(BaseModelViewSet):
    """階段模板（唯讀）。

    流程是資料不是程式——改流程走 Django Admin，不用改程式碼、不用重新部署。
    這裡只提供讀取，讓前端畫出軌道。
    """

    queryset = StageTemplate.objects.filter(is_active=True).prefetch_related("stages")
    serializer_class = StageTemplateSerializer
    read_permission = "view_tracking"
    write_permission = "manage_masters"
    http_method_names = ["get", "head", "options"]
    pagination_class = None

    def get_queryset(self):
        qs = super().get_queryset()
        if applies := self.request.query_params.get("applies_to"):
            qs = qs.filter(applies_to__in=applies.split(","))
        if bool_param(self.request, "for_units"):
            # 建立追蹤單元時可選的模板：專案主線不算在內
            qs = qs.exclude(applies_to=TemplateAppliesTo.PROJECT_MAIN)
        return qs.annotate(unit_total=Count("units")).order_by("applies_to", "-is_default", "code")
