from decimal import Decimal

from rest_framework import serializers

from main.apps.billing.models import BillingClaim, BillingClaimLog, BillingMilestone
from main.utils.choices import ClaimState, TriggerType
from main.utils.permissions import has_permission


class BillingClaimSerializer(serializers.ModelSerializer):
    """請款事件 —— 實際可以開發票的一筆錢。

    與里程碑分兩層的原因：`per_batch` 觸發時，
    一筆里程碑會產生 N 筆請款事件（每批一筆）。
    """

    state_label = serializers.CharField(source="get_state_display", read_only=True)
    source_label = serializers.CharField(source="get_source_display", read_only=True)
    triggered_by_name = serializers.CharField(
        source="triggered_by_unit.name", read_only=True, default="",
    )
    milestone_label = serializers.CharField(source="milestone.label", read_only=True)
    project_name = serializers.CharField(source="milestone.project.name", read_only=True)
    project_id = serializers.IntegerField(source="milestone.project_id", read_only=True)
    is_auto = serializers.BooleanField(read_only=True)
    next_states = serializers.SerializerMethodField()
    days_since_claimable = serializers.SerializerMethodField()

    class Meta:
        model = BillingClaim
        fields = [
            "id", "milestone", "milestone_label", "project_id", "project_name",
            "seq", "amount", "source", "source_label", "is_auto",
            "triggered_by_unit", "triggered_by_name", "weight_kg_snapshot",
            "state", "state_label", "next_states",
            "claimable_at", "invoice_date", "invoice_no", "receive_date",
            "days_since_claimable", "note",
        ]

    def get_next_states(self, obj) -> list[dict]:
        """這筆現在可以轉去哪些狀態。前端不用自己寫狀態機。"""
        user = getattr(self.context.get("request"), "user", None)
        if not has_permission(user, "transition_claim"):
            return []
        forward = {
            ClaimState.CLAIMABLE: [ClaimState.INVOICED],
            ClaimState.INVOICED: [ClaimState.RECEIVED, ClaimState.CLAIMABLE],
            ClaimState.RECEIVED: [ClaimState.INVOICED],
        }.get(obj.state, [])
        labels = dict(ClaimState.choices)
        return [{"value": s, "label": labels[s]} for s in forward]

    def get_days_since_claimable(self, obj) -> int | None:
        """可請款後放幾天了。超過 7 天沒開單就是漏掉的錢。"""
        from django.utils import timezone

        if obj.state != ClaimState.CLAIMABLE or not obj.claimable_at:
            return None
        return (timezone.now() - obj.claimable_at).days


class BillingMilestoneSerializer(serializers.ModelSerializer):
    """請款里程碑 —— 合約上寫的那一條。"""

    project_name = serializers.CharField(source="project.name", read_only=True)
    project_code = serializers.CharField(source="project.code", read_only=True)
    phase_name = serializers.CharField(source="phase.name", read_only=True, default="")
    state_label = serializers.CharField(source="get_state_display", read_only=True)
    trigger_label = serializers.CharField(source="get_trigger_type_display", read_only=True)
    target_location_name = serializers.CharField(
        source="target_location.name", read_only=True, default="",
    )
    outstanding_amount = serializers.SerializerMethodField()
    remaining_claimable = serializers.SerializerMethodField()
    is_weight_basis_locked = serializers.BooleanField(read_only=True)
    progress = serializers.SerializerMethodField()
    claims = BillingClaimSerializer(many=True, read_only=True)
    can_edit = serializers.SerializerMethodField()

    class Meta:
        model = BillingMilestone
        fields = [
            "id", "project", "project_name", "project_code", "phase", "phase_name",
            "seq", "label", "trigger_desc", "percentage", "amount",
            "trigger_type", "trigger_label", "threshold_pct",
            "target_location", "target_location_name",
            "weight_basis_kg", "weight_basis_locked_at", "is_weight_basis_locked",
            "claimable_amount", "claimed_amount", "received_amount",
            "outstanding_amount", "remaining_claimable",
            "state", "state_label", "claimable_at", "note",
            "progress", "claims", "can_edit",
        ]

    def get_outstanding_amount(self, obj) -> str:
        """還沒收到的錢＝金額 − 已收款"""
        return str(obj.outstanding_amount)

    def get_remaining_claimable(self, obj) -> str:
        """還能再建立多少請款＝金額 − 累計可請。

        與 outstanding 不同：部分請款後，這筆已經「可請」但還沒「收到」，
        outstanding 還是全額，但已經不能再建新的請款了。
        """
        return str(max(obj.amount - obj.claimable_amount, 0))

    def get_progress(self, obj) -> dict:
        """離觸發還差多少。

        合約寫「累計 80% 簽收才能請」，這裡就要回答「現在幾 %」——
        否則使用者只知道「還不能請」，不知道還差多遠。
        """
        if obj.trigger_type == TriggerType.MANUAL:
            return {"text": "手動建立，不自動觸發", "pct": None}

        from django.db.models import Count, Q, Sum

        from main.apps.billing.services import trigger_service

        # 四個數字一次 aggregate 算完。分開寫成 count()／count()／sum()／sum()
        # 是四趟 DB，一頁 20 筆里程碑就是 80 次查詢
        agg = trigger_service._phase_units(obj).aggregate(
            total_units=Count("id"),
            signed_units=Count("id", filter=Q(signoff_date__isnull=False)),
            total_w=Sum("total_weight_kg"),
            signed_w=Sum("total_weight_kg", filter=Q(signoff_date__isnull=False)),
        )
        total_units = agg["total_units"]
        signed_units = agg["signed_units"]
        if not total_units:
            return {"text": "此期尚未建立批次", "pct": None}

        total_w = agg["total_w"] or 0
        signed_w = agg["signed_w"] or 0
        pct = float(signed_w / total_w * 100) if total_w else None

        parts = [f"已簽收 {signed_units}/{total_units} 批"]
        if pct is not None:
            parts.append(f"{signed_w / 1000:.1f}/{total_w / 1000:.1f} 噸（{pct:.1f}%）")
        else:
            parts.append("批次尚未填重量")
        return {
            "text": "，".join(parts),
            "pct": round(pct, 1) if pct is not None else None,
            "threshold_pct": float(obj.threshold_pct) if obj.threshold_pct else None,
            "signed_units": signed_units,
            "total_units": total_units,
            "pending": self._pending_units(obj),
        }

    def _signoff_stages(self):
        """{模板 id: 需簽收的那一站}。

        整份清單只查一次。原本每筆里程碑各自 prefetch 一次模板階段，
        一頁 20 筆就是 40 次查詢——而模板全公司只有三條。
        """
        cache = self.context.get("_signoff_stage_map")
        if cache is None:
            from main.apps.masters.models import Stage

            cache = {}
            for stage in Stage.objects.filter(
                is_active=True, requires_signoff=True
            ).order_by("template_id", "seq"):
                cache.setdefault(stage.template_id, stage)
            self.context["_signoff_stage_map"] = cache
        return cache

    def _pending_units(self, milestone):
        """還沒簽收的批次，各自卡在哪一站。

        「已簽收 1/4 批」只說了還差 3 批，沒說是哪 3 批、現在在哪、
        還要推幾站才能簽。使用者看完還是不知道下一步要做什麼——
        這裡把它變成一份可以照著做的清單。
        """
        from main.apps.billing.services import trigger_service

        signoff_map = self._signoff_stages()
        pending = (
            trigger_service._phase_units(milestone)
            .filter(signoff_date__isnull=True)
            .select_related("current_stage")[:10]
        )
        rows = []
        for unit in pending:
            signoff_stage = signoff_map.get(unit.template_id)
            if signoff_stage is None:
                hint = "這條流程沒有需簽收的站，永遠不會觸發"
            elif unit.current_stage.seq < signoff_stage.seq:
                gap = signoff_stage.seq - unit.current_stage.seq
                hint = f"還要推 {gap} 站到「{signoff_stage.name}」才能簽收"
            elif unit.current_stage.seq == signoff_stage.seq:
                hint = "已在簽收站，等業主簽收"
            else:
                hint = f"已過「{signoff_stage.name}」但沒登錄簽收"
            rows.append({
                "id": unit.pk,
                "name": unit.name,
                "stage_name": unit.current_stage.name,
                "ready_to_sign": unit.is_awaiting_signoff,
                "hint": hint,
            })
        return rows

    def get_can_edit(self, obj) -> bool:
        return has_permission(getattr(self.context.get("request"), "user", None), "edit_milestone")


class BillingMilestoneWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = BillingMilestone
        fields = [
            "project", "phase", "seq", "label", "trigger_desc", "percentage",
            "trigger_type", "threshold_pct", "target_location", "note",
        ]
        # 預設的唯一性檢查會吐出英文的 "The fields project, seq must make a unique set"，
        # 而且掛在 non_field_errors 上，使用者看不到是哪一欄有問題。
        # 關掉它，改用下面自己寫的檢查。
        validators = []

    def validate_seq(self, value):
        if value is not None and value < 1:
            raise serializers.ValidationError("順序必須從 1 開始")
        return value

    def validate(self, attrs):
        trigger = attrs.get("trigger_type") or getattr(self.instance, "trigger_type", None)
        threshold = attrs.get("threshold_pct", getattr(self.instance, "threshold_pct", None))
        if trigger == TriggerType.WEIGHT_THRESHOLD and not threshold:
            raise serializers.ValidationError(
                {"threshold_pct": "觸發方式為「累計重量達門檻」時必須填寫門檻百分比"}
            )

        project = attrs.get("project") or getattr(self.instance, "project", None)
        seq = attrs.get("seq", getattr(self.instance, "seq", None))
        if project and seq is not None:
            clash = BillingMilestone.objects.filter(project=project, seq=seq)
            if self.instance:
                clash = clash.exclude(pk=self.instance.pk)
            existing = clash.first()
            if existing:
                raise serializers.ValidationError({
                    "seq": (
                        f"順序 {seq} 已被「{existing.label}」使用。"
                        f"這個專案目前用到第 {self._max_seq(project)} 號，建議填 "
                        f"{self._max_seq(project) + 1}"
                    )
                })
        return attrs

    @staticmethod
    def _max_seq(project):
        last = BillingMilestone.objects.filter(project=project).order_by("-seq").first()
        return last.seq if last else 0


class ClaimTransitionSerializer(serializers.Serializer):
    to_state = serializers.ChoiceField(choices=ClaimState.choices)
    date = serializers.DateField(required=False, allow_null=True, help_text="請款日或收款日")
    invoice_no = serializers.CharField(required=False, allow_blank=True, max_length=30)
    reason = serializers.CharField(
        required=False, allow_blank=True, max_length=500, help_text="往回轉時必填",
    )


class ManualClaimSerializer(serializers.Serializer):
    """人工建立請款事件（trigger_type = manual 的里程碑用）"""

    amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=Decimal("0"))
    note = serializers.CharField(required=False, allow_blank=True, max_length=300)


class ClaimLogSerializer(serializers.ModelSerializer):
    changed_by_name = serializers.CharField(source="changed_by.name", read_only=True, default="系統")

    class Meta:
        model = BillingClaimLog
        fields = [
            "id", "from_state", "to_state", "reason", "is_auto",
            "amount_snapshot", "changed_by_name", "changed_at",
        ]
