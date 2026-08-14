from rest_framework import serializers

from main.apps.masters.models import StageTemplate
from main.apps.masters.serializers import StageSerializer
from main.apps.tracking.models import ProgressLog, TrackingUnit, TrackingUnitStageLog
from main.utils.choices import TemplateAppliesTo, UnitType
from main.utils.permissions import has_permission


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
