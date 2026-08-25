from rest_framework import serializers

from main.apps.masters.models import StageTemplate
from main.apps.masters.serializers import StageSerializer
from main.apps.tracking.models import (
    FlowTask,
    FlowTaskAssignment,
    FlowUnit,
    ProgressLog,
    TrackingUnit,
    TrackingUnitStageLog,
)
from main.apps.tracking.models.flow_task import TERMINAL_STATUSES
from main.utils.choices import FlowState, TemplateAppliesTo, UnitType
from main.utils.permissions import has_permission


# ── 工作分配（工作項目 × 工段 × 員工）──────────────────────────────
class FlowTaskAssignmentSerializer(serializers.ModelSerializer):
    """一列＝派給一個員工的一份工段分量（如「切割中 50 噸 → 工廠員工1」）。

    也直接餵「我的任務」的工作分配清單，所以帶上專案／流程／項目的名字。
    """

    assignee_name = serializers.CharField(source="assignee.name", read_only=True, default="")
    is_done = serializers.BooleanField(read_only=True)
    unit = serializers.IntegerField(source="task.unit_id", read_only=True)
    task_name = serializers.CharField(source="task.name", read_only=True)
    task_qty = serializers.DecimalField(
        source="task.qty", max_digits=12, decimal_places=2, read_only=True,
    )
    unit_of_measure = serializers.CharField(source="task.unit_of_measure", read_only=True)
    flow_name = serializers.CharField(source="task.unit.flow_item.name", read_only=True)
    project_name = serializers.CharField(source="task.unit.project.name", read_only=True)

    class Meta:
        model = FlowTaskAssignment
        fields = [
            "id", "task", "status", "assignee", "assignee_name",
            "qty_assigned", "qty_done", "is_done",
            "unit", "task_name", "task_qty", "unit_of_measure",
            "flow_name", "project_name",
        ]
        extra_kwargs = {"assignee": {"required": True, "allow_null": False}}

    def validate(self, attrs):
        task = attrs.get("task") or (self.instance.task if self.instance else None)
        if self.instance and attrs.get("task") and attrs["task"] != self.instance.task:
            raise serializers.ValidationError({"task": "工作分配不能搬到別的工作項目"})

        status_ = attrs.get("status", getattr(self.instance, "status", ""))
        if status_ in TERMINAL_STATUSES:
            raise serializers.ValidationError(
                {"status": "「未開始」與「已完成」是頭尾狀態，不是可分配的工段"}
            )
        if task and status_ not in task.statuses:
            raise serializers.ValidationError(
                {"status": f"「{status_}」不在「{task.name}」的狀態清單裡——先在該項目上新增狀態"}
            )

        qty_assigned = attrs.get(
            "qty_assigned", getattr(self.instance, "qty_assigned", None)
        )
        qty_done = attrs.get("qty_done", getattr(self.instance, "qty_done", 0))
        if qty_assigned is not None and qty_assigned <= 0:
            raise serializers.ValidationError({"qty_assigned": "分配數量必須大於 0"})
        if qty_done < 0:
            raise serializers.ValidationError({"qty_done": "完成數量不可為負"})
        if qty_assigned is not None and qty_done > qty_assigned:
            raise serializers.ValidationError(
                {"qty_done": f"完成數量不可超過分配數量（{qty_assigned:g}）"}
            )

        # 同一項目同一工段的分配總量不可超過項目數量——分 250 噸出去但只有 200 噸是錯字
        if task and task.qty and qty_assigned is not None:
            others = task.assignments.filter(status=status_)
            if self.instance:
                others = others.exclude(pk=self.instance.pk)
            already = sum(a.qty_assigned for a in others)
            if already + qty_assigned > task.qty:
                remain = task.qty - already
                raise serializers.ValidationError({
                    "qty_assigned": f"「{status_}」已分配 {already:g}，"
                                    f"最多還能分 {remain:g}（項目總量 {task.qty:g}）"
                })
        return attrs


# ── 工作項目（流程單元的內容物清單）────────────────────────────────
class FlowTaskSerializer(serializers.ModelSerializer):
    """一列＝一個內容物：名稱、數量、單位、狀態、自己的狀態清單＋各工段分配。"""

    # 要 prefetch_related("assignments")，不然一列項目一次查詢
    assignments = FlowTaskAssignmentSerializer(many=True, read_only=True)
    progress_pct = serializers.FloatField(read_only=True)

    class Meta:
        model = FlowTask
        fields = [
            "id", "unit", "name", "qty", "unit_of_measure", "status", "statuses",
            "assignments", "progress_pct",
        ]
        extra_kwargs = {"status": {"required": False, "allow_blank": True}}

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("請填寫內容物名稱，如「鐵材」")
        return value

    def validate_statuses(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("狀態清單必須是清單")
        cleaned = []
        for item in value:
            if not isinstance(item, str) or not item.strip():
                raise serializers.ValidationError("狀態必須是文字，不可空白")
            name = item.strip()
            if len(name) > 20:
                raise serializers.ValidationError(f"狀態「{name[:20]}…」太長（最多 20 字）")
            if name in TERMINAL_STATUSES:
                continue  # 頭尾是隱含的，不進工段清單
            if name not in cleaned:
                cleaned.append(name)
        if len(cleaned) > 20:
            raise serializers.ValidationError("狀態最多 20 個")
        # 已有分配掛著的工段不能移除——分配會變孤兒
        if self.instance:
            in_use = {a.status for a in self.instance.assignments.all()}
            if missing := in_use - set(cleaned):
                raise serializers.ValidationError(
                    f"「{'、'.join(sorted(missing))}」已有工作分配，不能移除；請先刪除分配"
                )
        return cleaned

    def validate(self, attrs):
        # 項目不能搬去別張單元——歷史會對不上
        if self.instance and attrs.get("unit") and attrs["unit"] != self.instance.unit:
            raise serializers.ValidationError({"unit": "工作項目不能搬到別的流程單元"})
        # 空白狀態不覆蓋：建立時走模型預設「未開始」，修改時保留原值
        if not attrs.get("status", "未開始").strip():
            attrs.pop("status", None)
            if self.instance is None:
                attrs["status"] = "未開始"
        return attrs


# ── 流程單元（2026-08-14 流程制改版）───────────────────────────────
class FlowUnitSerializer(serializers.ModelSerializer):
    """流程單元。沒有任何金額欄位——員工與檢視角色都拿得到完整資料。"""

    project_name = serializers.CharField(source="project.name", read_only=True)
    project_code = serializers.CharField(source="project.code", read_only=True)

    seq = serializers.IntegerField(source="flow_item.seq", read_only=True)
    flow_code = serializers.CharField(source="flow_item.code", read_only=True)
    flow_name = serializers.CharField(source="flow_item.name", read_only=True)
    stage_seq = serializers.IntegerField(source="flow_item.stage.seq", read_only=True)
    stage_name = serializers.CharField(source="flow_item.stage.name", read_only=True)
    # 工作內容／產出物／完成條件是單元自己的欄位（生成時從目錄抄預設，之後每案可改）
    is_gate = serializers.BooleanField(source="flow_item.is_gate", read_only=True)

    state_label = serializers.CharField(source="get_state_display", read_only=True)
    assignee_name = serializers.CharField(source="assignee.name", read_only=True, default="")
    subcontractor_name = serializers.CharField(
        source="subcontractor.name", read_only=True, default=""
    )

    completion_ratio = serializers.FloatField(read_only=True)
    is_overdue = serializers.BooleanField(read_only=True)
    is_batch_driven = serializers.BooleanField(read_only=True)
    can_operate = serializers.SerializerMethodField()
    # 要 prefetch_related("tasks")，不然一列單元一次查詢
    tasks = FlowTaskSerializer(many=True, read_only=True)

    class Meta:
        model = FlowUnit
        fields = [
            "id", "project", "project_name", "project_code",
            "flow_item", "seq", "flow_code", "flow_name", "stage_seq", "stage_name",
            "description", "deliverables", "done_criteria", "is_gate",
            "state", "state_label", "assignee", "assignee_name", "detail",
            "plan_start", "plan_end", "actual_start", "actual_end",
            "qty_total", "qty_done", "unit_of_measure", "progress_pct",
            "completion_ratio", "is_overdue", "is_batch_driven",
            "subcontractor", "subcontractor_name", "note", "can_operate", "tasks",
        ]

    def get_can_operate(self, obj) -> bool:
        from main.apps.tracking.services.flow_service import can_operate

        request = self.context.get("request")
        user = getattr(request, "user", None)
        return bool(user and user.is_authenticated and can_operate(user, obj))


class FlowUnitWriteSerializer(serializers.ModelSerializer):
    """排程表逐列填的欄位：負責人、詳細內容、預計起訖、數量、分包商。

    project 與 flow_item 不在這裡——單元由建案勾選或 set-flows 產生，
    不能事後把一張單元搬到別的案子或改成別的流程。
    """

    class Meta:
        model = FlowUnit
        fields = [
            "assignee", "detail", "plan_start", "plan_end",
            "qty_total", "unit_of_measure", "subcontractor", "note",
            "description", "deliverables", "done_criteria",
        ]

    def validate(self, attrs):
        start = attrs.get("plan_start", getattr(self.instance, "plan_start", None))
        end = attrs.get("plan_end", getattr(self.instance, "plan_end", None))
        if start and end and end < start:
            raise serializers.ValidationError({"plan_end": "預計完成日不可早於預計開始日"})
        qty = attrs.get("qty_total", getattr(self.instance, "qty_total", None))
        done = getattr(self.instance, "qty_done", 0) if self.instance else 0
        if qty is not None and done and qty < done:
            raise serializers.ValidationError(
                {"qty_total": f"總數量不可小於已完成數量（{done:g}）"}
            )
        return attrs


class FlowTransitionSerializer(serializers.Serializer):
    to_state = serializers.ChoiceField(choices=FlowState.choices)
    note = serializers.CharField(required=False, allow_blank=True, max_length=500)


class FlowReportSerializer(serializers.Serializer):
    delta = serializers.DecimalField(max_digits=12, decimal_places=2, required=False)
    qty_done = serializers.DecimalField(max_digits=12, decimal_places=2, required=False)
    progress_pct = serializers.DecimalField(max_digits=5, decimal_places=2, required=False)
    note = serializers.CharField(required=False, allow_blank=True, max_length=500)

    def validate(self, attrs):
        if not any(k in attrs for k in ("delta", "qty_done", "progress_pct")):
            raise serializers.ValidationError("請提供增減量、完成數量或完成百分比其中之一")
        return attrs


class TrackingUnitCardSerializer(serializers.ModelSerializer):
    """看板卡片用的精簡版。

    一張卡要回答的問題只有四個：這是什麼、在哪一站、做多少了、有沒有卡住。
    """

    project_name = serializers.CharField(source="project.name", read_only=True)
    project_code = serializers.CharField(source="project.code", read_only=True)

    stage_id = serializers.IntegerField(source="current_stage_id", read_only=True)
    stage_name = serializers.CharField(source="current_stage.name", read_only=True)
    stage_seq = serializers.IntegerField(source="current_stage.seq", read_only=True)
    stage_total = serializers.IntegerField(read_only=True)

    completion_ratio = serializers.FloatField(read_only=True)
    days_in_stage = serializers.IntegerField(read_only=True)
    is_stalled = serializers.BooleanField(read_only=True)

    can_advance = serializers.SerializerMethodField()
    can_rollback = serializers.SerializerMethodField()
    can_report = serializers.SerializerMethodField()

    class Meta:
        model = TrackingUnit
        fields = [
            "id", "code", "name", "unit_type", "status",
            "project", "project_name", "project_code",
            "stage_id", "stage_name", "stage_seq", "stage_total",
            "qty_total", "qty_done", "unit_of_measure", "progress_pct", "completion_ratio",
            "days_in_stage", "is_stalled", "plan_end",
            "can_advance", "can_rollback", "can_report",
        ]

    def _user(self):
        request = self.context.get("request")
        return getattr(request, "user", None)

    def get_can_advance(self, obj) -> bool:
        return obj.can_advance and has_permission(self._user(), "edit_tracking")

    def get_can_rollback(self, obj) -> bool:
        return obj.can_rollback and has_permission(self._user(), "edit_tracking")

    def get_can_report(self, obj) -> bool:
        return has_permission(self._user(), "edit_tracking")


class TrackingUnitDetailSerializer(TrackingUnitCardSerializer):
    """明細。多帶完整階段軌道與日期。"""

    current_stage = StageSerializer(read_only=True)
    stages = serializers.SerializerMethodField()
    subcontractor_name = serializers.CharField(source="subcontractor.name", read_only=True, default="")
    quick_increments = serializers.SerializerMethodField()

    class Meta(TrackingUnitCardSerializer.Meta):
        fields = TrackingUnitCardSerializer.Meta.fields + [
            "current_stage", "stages", "note",
            "subcontractor", "subcontractor_name",
            "plan_start", "actual_start", "actual_end",
            "quick_increments",
        ]

    def get_stages(self, obj) -> list[dict]:
        stages = obj.template.stages.filter(is_active=True).order_by("seq")
        return StageSerializer(stages, many=True).data

    def get_quick_increments(self, obj) -> list[float]:
        from main.apps.tracking.services.stage_service import quick_increments

        if obj.unit_type != UnitType.BATCH:
            return []
        return quick_increments(obj)


class TrackingUnitWriteSerializer(serializers.ModelSerializer):
    """建立／修改追蹤單元。

    ★ 使用者選的是**階段模板**，不是寫死的類型。
    在 Admin 新增一條模板，它就會出現在下拉裡——加流程不用改程式。

    `unit_type` 由模板的 applies_to 推導，使用者不必也不該自己選：
    選了土建模板卻標成構件批次，進度就會用錯的算法。
    """

    # QuerySet 是惰性的，在此宣告不會在載入時查 DB
    template = serializers.PrimaryKeyRelatedField(
        queryset=StageTemplate.objects.filter(is_active=True).exclude(
            applies_to=TemplateAppliesTo.PROJECT_MAIN
        ),
        required=False, allow_null=True,
        help_text="階段模板。不指定時用該類型的預設模板",
    )

    class Meta:
        model = TrackingUnit
        fields = [
            "project", "template", "unit_type", "name", "note",
            "qty_total", "unit_of_measure", "progress_pct",
            "subcontractor", "plan_start", "plan_end",
        ]
        extra_kwargs = {"unit_type": {"required": False}}

    def validate(self, attrs):
        template = attrs.get("template")
        if template is not None:
            attrs["unit_type"] = self._type_of(template)
        unit_type = attrs.get("unit_type") or getattr(self.instance, "unit_type", None)
        if unit_type is None:
            raise serializers.ValidationError({"template": "請選擇階段模板"})
        attrs["unit_type"] = unit_type
        if unit_type == UnitType.BATCH:
            qty = attrs.get("qty_total", getattr(self.instance, "qty_total", None))
            if not qty or qty <= 0:
                raise serializers.ValidationError({"qty_total": "構件批次必須填寫總數量且大於 0"})
            if not (attrs.get("unit_of_measure") or getattr(self.instance, "unit_of_measure", "")):
                raise serializers.ValidationError({"unit_of_measure": "構件批次必須填寫單位"})
            # 構件批次不該有百分比欄位，留著會讓 completion_ratio 的來源變得曖昧
            attrs["progress_pct"] = None
        else:
            # 資料庫的 CHECK 約束要求土建工項一定要有百分比。
            # 沒填就當 0（還沒開始），而不是讓約束擋下來回 500
            if attrs.get("progress_pct") is None and self.instance is None:
                attrs["progress_pct"] = 0
            attrs["qty_total"] = None
            attrs["qty_done"] = 0
        return attrs

    @staticmethod
    def _type_of(template):
        return (
            UnitType.WORK_ITEM
            if template.applies_to == TemplateAppliesTo.CIVIL_WORK_ITEM
            else UnitType.BATCH
        )

    def create(self, validated_data):
        from main.utils.exceptions import BusinessRuleError

        template = validated_data.get("template")
        if template is None:
            applies = (
                TemplateAppliesTo.STEEL_BATCH
                if validated_data["unit_type"] == UnitType.BATCH
                else TemplateAppliesTo.CIVIL_WORK_ITEM
            )
            template = StageTemplate.default_for(applies)
            if template is None:
                raise BusinessRuleError(
                    "尚未設定對應的階段模板。請由系統管理員在 /admin/masters/stagetemplate/ 建立"
                )
            validated_data["template"] = template

        first = template.first_stage()
        if first is None:
            raise BusinessRuleError(f"階段模板「{template.name}」底下沒有任何啟用中的階段")
        validated_data["current_stage"] = first
        return super().create(validated_data)

    def update(self, instance, validated_data):
        from main.utils.exceptions import BusinessRuleError

        # 換模板等於換一條流程。已經走過幾站的東西不能中途換軌——歷程會對不上
        new_template = validated_data.get("template")
        if new_template and new_template.pk != instance.template_id:
            if instance.stage_logs.exists():
                raise BusinessRuleError(
                    "此追蹤單元已有階段異動紀錄，不可更換階段模板。"
                    "若流程真的要改，請建立新的追蹤單元"
                )
            validated_data["current_stage"] = new_template.first_stage()
        return super().update(instance, validated_data)


# ── 操作用的序列化器 ───────────────────────────────────────────────
class MoveStageSerializer(serializers.Serializer):
    direction = serializers.ChoiceField(choices=[("forward", "推進"), ("backward", "回退")])
    note = serializers.CharField(required=False, allow_blank=True, max_length=500)
    expected_stage_id = serializers.IntegerField(
        required=False, help_text="樂觀鎖：前端看到的階段。與現況不符表示有人搶先改了",
    )


class ReportProgressSerializer(serializers.Serializer):
    delta = serializers.DecimalField(max_digits=12, decimal_places=2, required=False)
    qty_done = serializers.DecimalField(max_digits=12, decimal_places=2, required=False)
    progress_pct = serializers.DecimalField(max_digits=5, decimal_places=2, required=False)
    note = serializers.CharField(required=False, allow_blank=True, max_length=500)

    def validate(self, attrs):
        if not any(k in attrs for k in ("delta", "qty_done", "progress_pct")):
            raise serializers.ValidationError("請提供增減量、完成數量或完成百分比其中之一")
        return attrs


# ── 歷程 ───────────────────────────────────────────────────────────
class StageLogSerializer(serializers.ModelSerializer):
    """階段歷程。

    顯示的是 **名稱快照**（from_stage_name／to_stage_name），
    不是關聯的階段名——階段日後改名，歷史紀錄仍是當時的樣子。
    """

    moved_by_name = serializers.CharField(source="moved_by.name", read_only=True, default="系統")
    is_rollback = serializers.BooleanField(read_only=True)

    class Meta:
        model = TrackingUnitStageLog
        fields = [
            "id", "from_stage_name", "to_stage_name", "direction", "is_rollback",
            "note", "moved_by_name", "moved_at",
            # 離開原階段時做到哪——完成度換站歸零，這是唯一查得回來的地方
            "qty_at_exit", "pct_at_exit",
        ]


class ProgressLogSerializer(serializers.ModelSerializer):
    reported_by_name = serializers.CharField(source="reported_by.name", read_only=True, default="系統")

    class Meta:
        model = ProgressLog
        fields = [
            "id", "qty_before", "qty_after", "pct_before", "pct_after",
            "delta", "note", "reported_by_name", "reported_at",
        ]
