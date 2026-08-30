from rest_framework import serializers

from main.apps.billing.models import BillingMilestone, MilestoneLog
from main.utils.choices import MilestoneState
from main.utils.permissions import has_permission


class BillingMilestoneSerializer(serializers.ModelSerializer):
    """應收款 —— 合約付款條件的一列，同時就是實際請款的那一列。"""

    project_name = serializers.CharField(source="project.name", read_only=True)
    project_code = serializers.CharField(source="project.code", read_only=True)
    state_label = serializers.CharField(source="get_state_display", read_only=True)
    trigger_unit_name = serializers.CharField(
        source="trigger_unit.flow_display_name", read_only=True, default=""
    )
    trigger_unit_state = serializers.CharField(
        source="trigger_unit.state", read_only=True, default=""
    )
    accountant_name = serializers.CharField(
        source="accountant.name", read_only=True, default=""
    )
    forecast_date = serializers.DateField(read_only=True)
    outstanding_amount = serializers.SerializerMethodField()
    next_states = serializers.SerializerMethodField()
    days_since_claimable = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()

    class Meta:
        model = BillingMilestone
        fields = [
            "id", "project", "project_name", "project_code",
            "seq", "label", "condition", "percentage", "amount",
            "state", "state_label", "next_states",
            "trigger_unit", "trigger_unit_name", "trigger_unit_state",
            "accountant", "accountant_name",
            "expected_date", "forecast_date", "claimable_at",
            "invoice_date", "invoice_no", "due_date", "receive_date",
            "outstanding_amount", "days_since_claimable", "note", "can_edit",
        ]

    def get_outstanding_amount(self, obj) -> str:
        return str(obj.outstanding_amount)

    def get_next_states(self, obj) -> list[dict]:
        """這筆現在可以轉去哪些狀態。前端不用自己寫狀態機。"""
        user = getattr(self.context.get("request"), "user", None)
        if not has_permission(user, "transition_milestone"):
            return []
        forward = {
            MilestoneState.PENDING: [MilestoneState.CLAIMABLE],
            MilestoneState.CLAIMABLE: [MilestoneState.INVOICED, MilestoneState.PENDING],
            MilestoneState.INVOICED: [MilestoneState.RECEIVED, MilestoneState.CLAIMABLE],
            MilestoneState.RECEIVED: [MilestoneState.INVOICED],
        }.get(obj.state, [])
        labels = dict(MilestoneState.choices)
        return [{"value": s, "label": labels[s]} for s in forward]

    def get_days_since_claimable(self, obj) -> int | None:
        """可請款後放幾天了。超過 7 天沒開單就是漏掉的錢。"""
        from django.utils import timezone

        if obj.state != MilestoneState.CLAIMABLE or not obj.claimable_at:
            return None
        return (timezone.now() - obj.claimable_at).days

    def get_can_edit(self, obj) -> bool:
        return has_permission(getattr(self.context.get("request"), "user", None), "edit_milestone")


class BillingMilestoneWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = BillingMilestone
        fields = [
            "project", "seq", "label", "condition", "percentage",
            "trigger_unit", "accountant", "expected_date", "note",
        ]
        extra_kwargs = {"seq": {"required": False}}
        # 預設的唯一性檢查會吐出英文的 "The fields project, seq must make a unique set"，
        # 而且掛在 non_field_errors 上。關掉它，改用下面自己寫的檢查。
        validators = []

    def validate_seq(self, value):
        if value is not None and value < 1:
            raise serializers.ValidationError("順序必須從 1 開始")
        return value

    def validate(self, attrs):
        project = attrs.get("project") or getattr(self.instance, "project", None)
        trigger = attrs.get("trigger_unit")
        if trigger and project and trigger.project_id != project.pk:
            raise serializers.ValidationError({"trigger_unit": "觸發流程不屬於這個專案"})
        # D46：一個流程只能掛一期——掛了第二期，「這步完成收哪期」就說不清了
        if trigger:
            clash = BillingMilestone.objects.filter(trigger_unit=trigger)
            if self.instance:
                clash = clash.exclude(pk=self.instance.pk)
            if other := clash.first():
                raise serializers.ValidationError({
                    "trigger_unit": f"這個流程已經掛了「{other.label}」，先取消那筆連結再掛新的"
                })
        seq = attrs.get("seq", getattr(self.instance, "seq", None))
        # 新增時沒給順序就自動排最後——使用者不需要知道「順序」這種內部概念
        if seq is None and self.instance is None and project:
            seq = self._max_seq(project) + 1
            attrs["seq"] = seq
        if project and seq is not None:
            clash = BillingMilestone.objects.filter(project=project, seq=seq)
            if self.instance:
                clash = clash.exclude(pk=self.instance.pk)
            existing = clash.first()
            if existing:
                max_seq = self._max_seq(project)
                raise serializers.ValidationError({
                    "seq": (
                        f"順序 {seq} 已被「{existing.label}」使用。"
                        f"這個專案目前用到第 {max_seq} 號，建議填 {max_seq + 1}"
                    )
                })
        return attrs

    @staticmethod
    def _max_seq(project):
        last = BillingMilestone.objects.filter(project=project).order_by("-seq").first()
        return last.seq if last else 0


class MilestoneTransitionSerializer(serializers.Serializer):
    to_state = serializers.ChoiceField(choices=MilestoneState.choices)
    date = serializers.DateField(required=False, allow_null=True, help_text="請款日或收款日")
    invoice_no = serializers.CharField(required=False, allow_blank=True, max_length=30)
    reason = serializers.CharField(
        required=False, allow_blank=True, max_length=500, help_text="往回轉時必填",
    )


class MilestoneLogSerializer(serializers.ModelSerializer):
    changed_by_name = serializers.CharField(source="changed_by.name", read_only=True, default="系統")

    class Meta:
        model = MilestoneLog
        fields = [
            "id", "from_state", "to_state", "reason",
            "amount_snapshot", "changed_by_name", "changed_at",
        ]
