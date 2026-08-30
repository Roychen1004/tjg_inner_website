from django.db.models import Count, Exists, F, OuterRef, Q
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from main.apps.masters.models import Stage, StageTemplate
from main.apps.masters.serializers import StageTemplateSerializer
from main.apps.tracking.models import (
    AssignmentReport,
    FlowTask,
    FlowTaskAssignment,
    FlowUnit,
    ProgressLog,
    TrackingUnit,
    TrackingUnitStageLog,
)
from main.apps.tracking.serializers import (
    FlowReportSerializer,
    FlowTaskAssignmentSerializer,
    FlowTaskSerializer,
    FlowTransitionSerializer,
    FlowUnitSerializer,
    FlowUnitWriteSerializer,
    MoveStageSerializer,
    ProgressLogSerializer,
    ReportProgressSerializer,
    StageLogSerializer,
    TrackingUnitCardSerializer,
    TrackingUnitDetailSerializer,
    TrackingUnitWriteSerializer,
)
from main.apps.tracking.services import flow_service, stage_service
from main.utils.choices import FlowState, StageDirection, Status, TemplateAppliesTo
from main.utils.permissions import has_permission
from main.utils.scoping import scope_tracking_units
from main.utils.viewsets import BaseModelViewSet, bool_param

CARD_SELECT = ("project", "current_stage", "template")


class FlowUnitViewSet(BaseModelViewSet):
    """流程單元 —— 建案勾選的每個流程各一張。

    建立不走這裡（用 POST /projects 或 /projects/{id}/set-flows），
    這裡負責：排程表逐列修改（PATCH）、狀態轉換、進度回報、我的任務清單。
    """

    queryset = FlowUnit.objects.select_related(
        "project", "flow_item", "stage", "assignee", "subcontractor"
    ).prefetch_related("tasks__assignments__assignee").annotate(
        _has_batches=Exists(TrackingUnit.objects.filter(project=OuterRef("project_id")))
    )
    serializer_class = FlowUnitSerializer
    write_serializer_class = FlowUnitWriteSerializer
    scope_function = staticmethod(scope_tracking_units)
    read_permission = None
    # ⚠️ 刻意是 None：員工（staff）沒有 edit_tracking，但要能對**自己被指派的**
    # 單元 POST transition／report-progress。類別層放行後，每個寫入方法
    # 自己先檢查權限（403 先於 400，鐵律 2）——update/destroy 要 edit_tracking，
    # transition/report 要 can_operate（負責人本人或 edit_tracking）。
    write_permission = None

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params

        if project := params.get("project"):
            qs = qs.filter(project_id=project)
        if st := params.get("state"):
            qs = qs.filter(state__in=st.split(","))
        if stage := params.get("stage"):
            qs = qs.filter(stage__seq=stage)
        if assignee := params.get("assignee"):
            qs = qs.filter(
                assignee=self.request.user if assignee == "me" else assignee
            )
        if bool_param(self.request, "overdue"):
            from django.utils import timezone

            qs = qs.filter(
                state__in=[FlowState.TODO, FlowState.DOING],
                plan_end__lt=timezone.localdate(),
            )
        if bool_param(self.request, "open"):
            qs = qs.exclude(state__in=[FlowState.DONE, FlowState.NA])
        if q := params.get("q"):
            qs = qs.filter(
                Q(flow_item__name__icontains=q) | Q(name__icontains=q)
                | Q(project__name__icontains=q)
            )
        # D49：順序看單元自己的 seq（每案可重排），不再跟目錄
        return qs.order_by("project_id", "seq", "id")

    def create(self, request, *args, **kwargs):
        return Response(
            {
                "type": "validation_error",
                "detail": "流程單元不能單獨建立",
                "hint": "在建案表單勾選流程，或用專案明細的「編輯流程」加勾",
            },
            status=status.HTTP_405_METHOD_NOT_ALLOWED,
        )

    def update(self, request, *args, **kwargs):
        if not has_permission(request.user, "edit_tracking"):
            return _denied("只有有進度維護權限的人能編輯排程")
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        if not has_permission(request.user, "edit_tracking"):
            return _denied("只有有進度維護權限的人能移除流程")
        return super().destroy(request, *args, **kwargs)

    def perform_update(self, serializer):
        old_assignee = serializer.instance.assignee_id
        unit = serializer.save()
        if unit.assignee_id and unit.assignee_id != old_assignee:
            from main.apps.tracking.services import notify_service

            notify_service.assigned(unit, self.request.user)

    def perform_destroy(self, instance):
        from main.utils.exceptions import BusinessRuleError

        if instance.state not in (FlowState.TODO, FlowState.NA):
            raise BusinessRuleError(
                "已開始或已完成的流程不能刪除。若確定不做了，請改標「不適用」保留紀錄"
            )
        if _has_attachments(instance):
            raise BusinessRuleError("此流程已有附件，請先刪除附件或改標「不適用」")
        if instance.payables.exists():
            raise BusinessRuleError("此流程掛著應付款項，不能刪除。請改標「不適用」")
        project = instance.project
        instance.delete()
        # 少一條流程，後面的顯示編號往前遞補（D51）
        flow_service.renumber_codes(project)

    # ── 操作 ───────────────────────────────────────────────────────
    @extend_schema(request=FlowTransitionSerializer, responses=FlowUnitSerializer)
    @action(detail=True, methods=["post"])
    def transition(self, request, pk=None):
        """開始／完成／重啟／標不適用。負責人可以動自己的單元。"""
        unit = self.get_object()
        serializer = FlowTransitionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        to_state = serializer.validated_data["to_state"]

        if not flow_service.can_operate(request.user, unit):
            return _denied("只有負責人或有進度維護權限的人能操作這張單元")
        # 「不適用」是專案管理層面的決定，負責人不能自己把任務標掉
        if FlowState.NA in (to_state, unit.state) and not has_permission(
            request.user, "edit_tracking"
        ):
            return _denied("標記「不適用」需要進度維護權限")

        unit = flow_service.transition(
            unit.pk, to_state, request.user, note=serializer.validated_data.get("note", ""),
        )
        return self._read_response(unit)

    @extend_schema(request=FlowReportSerializer, responses=FlowUnitSerializer)
    @action(detail=True, methods=["post"], url_path="report-progress")
    def report_progress(self, request, pk=None):
        unit = self.get_object()
        if not flow_service.can_operate(request.user, unit):
            return _denied("只有負責人或有進度維護權限的人能回報進度")

        serializer = FlowReportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        unit = flow_service.report_progress(
            unit.pk, request.user,
            qty_done=data.get("qty_done"), delta=data.get("delta"),
            progress_pct=data.get("progress_pct"), note=data.get("note", ""),
        )
        return self._read_response(unit)


def _has_attachments(unit):
    from django.contrib.contenttypes.models import ContentType

    from main.apps.core.models import Attachment

    ct = ContentType.objects.get_for_model(FlowUnit)
    return Attachment.objects.filter(content_type=ct, object_id=unit.pk).exists()


class FlowTaskViewSet(BaseModelViewSet):
    """工作項目 —— 流程單元的內容物清單（如「鐵材 500 噸：已下訂單」）。

    讀取直接內嵌在流程單元的 `tasks` 欄位，這裡負責增刪改。
    操作權跟單元一致：負責人本人或有進度維護權限的人。
    """

    queryset = FlowTask.objects.select_related(
        "unit__project", "unit__flow_item", "unit__assignee"
    ).prefetch_related("assignments__assignee")
    serializer_class = FlowTaskSerializer
    read_permission = None
    # 逐方法檢查 can_operate——員工要能維護自己被指派單元的項目
    write_permission = None

    def get_queryset(self):
        qs = super().get_queryset()
        if unit := self.request.query_params.get("unit"):
            qs = qs.filter(unit_id=unit)
        return qs

    def _can_operate(self, unit):
        return flow_service.can_operate(self.request.user, unit)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if not self._can_operate(serializer.validated_data["unit"]):
            return _denied("只有負責人或有進度維護權限的人能新增工作項目")
        self.perform_create(serializer)
        return self._read_response(serializer.instance, status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        if not self._can_operate(self.get_object().unit):
            return _denied("只有負責人或有進度維護權限的人能修改工作項目")
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        if not self._can_operate(self.get_object().unit):
            return _denied("只有負責人或有進度維護權限的人能刪除工作項目")
        return super().destroy(request, *args, **kwargs)


class FlowTaskAssignmentViewSet(BaseModelViewSet):
    """工作分配（D41）——把工作項目的一個工段分量派給一個員工。

    權限兩層：
      · 分配／改派／刪除　＝單元的 can_operate（主要負責人或有進度維護權）
      · 回報完成量　　　　＝被分到的員工本人（只能動 qty_done）
    """

    queryset = FlowTaskAssignment.objects.select_related(
        "task__unit__project", "task__unit__flow_item", "assignee", "work_type"
    )
    serializer_class = FlowTaskAssignmentSerializer
    read_permission = None
    write_permission = None  # 逐方法檢查（員工要能回報自己的分配）

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if task := params.get("task"):
            qs = qs.filter(task_id=task)
        if unit := params.get("unit"):
            qs = qs.filter(task__unit_id=unit)
        if assignee := params.get("assignee"):
            qs = qs.filter(
                assignee=self.request.user if assignee == "me" else assignee
            )
        # open＝還沒做完的（「我的任務」列這些）
        if bool_param(self.request, "open"):
            qs = qs.filter(qty_done__lt=F("qty_assigned"))
        return qs.order_by("id")

    def _can_operate(self, unit):
        return flow_service.can_operate(self.request.user, unit)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if not self._can_operate(serializer.validated_data["task"].unit):
            return _denied("只有負責人或有進度維護權限的人能分配工作")
        self.perform_create(serializer)
        from main.apps.tracking.services import notify_service

        notify_service.task_assigned(serializer.instance, request.user)
        return self._read_response(serializer.instance, status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        assignment = self.get_object()
        if not self._can_operate(assignment.task.unit):
            # 員工本人只能回報自己這份分配的完成量
            if assignment.assignee_id != request.user.pk:
                return _denied("只有被分到的員工本人或有進度維護權限的人能修改")
            if extra := set(request.data) - {"qty_done"}:
                return _denied(f"回報只能填完成數量（不可修改：{'、'.join(sorted(extra))}）")
        was_done = assignment.is_done
        before_qty = assignment.qty_done
        response = super().update(request, *args, **kwargs)
        if response.status_code == 200:
            assignment.refresh_from_db()
            # D52：直接改完成量也要進回報流水帳，並蓋開始／完成日
            from main.apps.tracking.services import notify_service, productivity_service

            productivity_service.stamp_after_change(assignment, request.user, before_qty)
            if assignment.is_done and not was_done:
                notify_service.task_progress(assignment, request.user)
            response.data = self.get_serializer(assignment).data
        return response

    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        """員工按「開始」（D52）——經理在人員看板看得到誰開始了、誰還沒。"""
        from django.utils import timezone

        assignment = self.get_object()
        if assignment.assignee_id != request.user.pk and not self._can_operate(
            assignment.task.unit
        ):
            return _denied("只有被分到的員工本人能按開始")
        if assignment.started_at is None:
            assignment.started_at = timezone.localdate()
            assignment.save(update_fields=["started_at", "updated_at"])
        return Response(self.get_serializer(assignment).data)

    @action(detail=True, methods=["post"])
    def report(self, request, pk=None):
        """當日工作結束回報（D52）——寫入回報流水帳，工數由此自動計。

        body：{qty_done 或 delta}，可另帶 date（YYYY-MM-DD）補登。
        量會自動夾在 0 與分配量之間。
        """
        import datetime as dt
        from decimal import InvalidOperation

        assignment = self.get_object()
        if assignment.assignee_id != request.user.pk and not self._can_operate(
            assignment.task.unit
        ):
            return _denied("只有被分到的員工本人或有進度維護權限的人能回報")

        qty_done, delta = request.data.get("qty_done"), request.data.get("delta")
        if qty_done is None and delta is None:
            return Response(
                {"type": "validation_error", "detail": "請填 qty_done 或 delta"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        date = None
        if raw := request.data.get("date"):
            try:
                date = dt.date.fromisoformat(str(raw))
            except ValueError:
                return Response(
                    {"type": "validation_error", "detail": "date 格式須為 YYYY-MM-DD"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        try:
            was_done = assignment.is_done
            from main.apps.tracking.services import notify_service, productivity_service

            assignment, _ = productivity_service.record_report(
                assignment, request.user, qty_done=qty_done, delta=delta, date=date,
            )
        except (InvalidOperation, TypeError, ValueError):
            return Response(
                {"type": "validation_error", "detail": "數量必須是數字"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if assignment.is_done and not was_done:
            notify_service.task_progress(assignment, request.user)
        return Response(self.get_serializer(assignment).data)

    def destroy(self, request, *args, **kwargs):
        if not self._can_operate(self.get_object().task.unit):
            return _denied("只有負責人或有進度維護權限的人能刪除工作分配")
        return super().destroy(request, *args, **kwargs)


def _denied(message):
    return Response(
        {"type": "permission_denied", "detail": message},
        status=status.HTTP_403_FORBIDDEN,
    )


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
    read_permission = None  # 登入即可看進度；金額不經過這裡
    write_permission = "edit_tracking"

    def perform_create(self, serializer):
        # 批次的張數變了，階段 4 流程單元的分母跟著變
        unit = serializer.save()
        flow_service.sync_batch_rollup(unit.project, self.request.user)

    def perform_destroy(self, instance):
        project = instance.project
        instance.delete()
        flow_service.sync_batch_rollup(project, self.request.user)

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params

        if q := params.get("q"):
            qs = qs.filter(Q(code__icontains=q) | Q(name__icontains=q) | Q(project__name__icontains=q))
        if project := params.get("project"):
            qs = qs.filter(project_id=project)
        if unit_type := params.get("unit_type"):
            qs = qs.filter(unit_type=unit_type)
        if stage := params.get("stage"):
            qs = qs.filter(current_stage_id=stage)
        if st := params.get("status"):
            qs = qs.filter(status__in=st.split(","))
        if bool_param(self.request, "attention"):
            qs = qs.filter(status__in=[Status.ATRISK, Status.DELAYED])
        return qs

    # ── 操作 ───────────────────────────────────────────────────────
    @extend_schema(request=MoveStageSerializer)
    @action(detail=True, methods=["post"], url_path="move-stage")
    def move_stage(self, request, pk=None):
        """推進或回退一個階段。"""
        if not has_permission(request.user, "edit_tracking"):
            return self._denied("你沒有推進階段的權限")

        unit = self.get_object()
        serializer = MoveStageSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        direction = (
            StageDirection.FORWARD if data["direction"] == "forward" else StageDirection.BACKWARD
        )
        unit, _log = stage_service.move_stage(
            unit.pk, direction, request.user,
            note=data.get("note", ""),
            expected_stage_id=data.get("expected_stage_id"),
        )
        unit.refresh_from_db()
        return Response({
            "unit": TrackingUnitDetailSerializer(
                unit, context=self.get_serializer_context()
            ).data,
        })

    @extend_schema(request=ReportProgressSerializer)
    @action(detail=True, methods=["post"], url_path="report-progress")
    def report_progress(self, request, pk=None):
        """回報進度。

        用 delta（+5）而不是絕對值——兩個人同時回報 +5 會正確加 10；
        用絕對值的話後者會覆蓋前者，少算 5 支。
        """
        if not has_permission(request.user, "edit_tracking"):
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
    read_permission = None
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


class StaffWorkloadView(APIView):
    """GET /staff-workload?month=YYYY-MM（D46）

    回答的問題：**每個員工手上有什麼、這個月做完了什麼**。
    「手上」＝進行中的工作分配＋負責的未完成流程；
    「做完」＝該月回報做滿的分配＋該月實際完成的流程。
    不含任何金額，所有登入者都能看。
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(
        parameters=[OpenApiParameter("month", str, description="YYYY-MM，預設本月")],
        responses=OpenApiTypes.OBJECT,
    )
    def get(self, request):
        import datetime as dt

        from django.utils import timezone

        from main.apps.core.models import User

        raw = request.query_params.get("month", "")
        try:
            year, mon = (int(x) for x in raw.split("-"))
            first = dt.date(year, mon, 1)
        except (TypeError, ValueError):
            first = timezone.localdate().replace(day=1)
        next_first = (first.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
        tz = timezone.get_current_timezone()
        start_dt = dt.datetime.combine(first, dt.time.min, tzinfo=tz)
        end_dt = dt.datetime.combine(next_first, dt.time.min, tzinfo=tz)

        people = list(
            User.objects.filter(is_active=True, is_superuser=False)
            .order_by("employee_no", "username")
        )
        rows = {
            u.pk: {
                "id": u.pk, "name": u.name, "title": u.title,
                "open_units": [], "open_assignments": [],
                "done_units": [], "done_assignments": [],
            }
            for u in people
        }

        def unit_brief(unit):
            return {
                "id": unit.pk,
                "project_name": unit.project.name,
                "flow_name": unit.flow_display_name,
                "state": unit.state,
                "plan_end": unit.plan_end,
                "actual_end": unit.actual_end,
            }

        def assignment_brief(a):
            return {
                "id": a.pk,
                "unit": a.task.unit_id,
                "project_name": a.task.unit.project.name,
                "flow_name": a.task.unit.flow_display_name,
                "task_name": a.task.name,
                "status": a.status,
                "qty_done": a.qty_done,
                "qty_assigned": a.qty_assigned,
                "unit_of_measure": a.task.unit_of_measure,
                "reported_at": timezone.localtime(a.updated_at).date(),
                # D52：老闆要看「誰開始了、誰還沒」——三色狀態靠這幾欄
                "work_type_name": a.work_type.name if a.work_type else "",
                "started_at": a.started_at,
                "completed_at": a.completed_at,
            }

        assign_qs = FlowTaskAssignment.objects.filter(assignee__in=people).select_related(
            "task__unit__project", "task__unit__flow_item", "work_type"
        )
        briefs = {}
        for a in assign_qs.filter(qty_done__lt=F("qty_assigned")):
            briefs[a.pk] = (assignment_brief(a), a)
            rows[a.assignee_id]["open_assignments"].append(briefs[a.pk][0])
        for a in assign_qs.filter(
            qty_done__gte=F("qty_assigned"), updated_at__gte=start_dt, updated_at__lt=end_dt
        ):
            briefs[a.pk] = (assignment_brief(a), a)
            rows[a.assignee_id]["done_assignments"].append(briefs[a.pk][0])

        # D52：批次補工數與「今日已回報」（一筆一查會打爆 DB，一律批次）
        from main.apps.tracking.services import productivity_service

        today = timezone.localdate()
        man_days = productivity_service.man_days_for([a for _, a in briefs.values()])
        reported_today = set(
            AssignmentReport.objects.filter(
                assignment_id__in=briefs, date=today
            ).values_list("assignment_id", flat=True)
        )
        for aid, (brief, _a) in briefs.items():
            brief["man_days"] = man_days.get(aid, 0)
            brief["reported_today"] = aid in reported_today

        unit_qs = FlowUnit.objects.filter(assignee__in=people).select_related(
            "project", "flow_item"
        )
        for u in unit_qs.filter(state__in=[FlowState.TODO, FlowState.DOING]):
            rows[u.assignee_id]["open_units"].append(unit_brief(u))
        for u in unit_qs.filter(
            state=FlowState.DONE, actual_end__gte=first, actual_end__lt=next_first
        ):
            rows[u.assignee_id]["done_units"].append(unit_brief(u))

        return Response({
            "month": f"{first.year:04d}-{first.month:02d}",
            "staff": [rows[u.pk] for u in people],
        })
