from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import models
from simple_history.models import HistoricalRecords

from main.apps.core.models import TimeStampedModel
from main.utils.choices import MilestoneState, TriggerType


class BillingMilestone(TimeStampedModel):
    """請款里程碑 —— 合約條件層

    這一層描述「合約怎麼寫」，實際的請款事件在 BillingClaim。
    分兩層是因為 per_batch（每批分批請）時，一個合約條件會產生多筆請款，
    單一狀態機表達不了「部分已請、部分可請、部分未到」。
    """

    project = models.ForeignKey(
        "projects.Project", verbose_name="專案",
        on_delete=models.CASCADE, related_name="milestones",
    )
    phase = models.ForeignKey(
        "projects.ProjectPhase", verbose_name="對應期別",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="milestones",
        help_text="決定哪些批次的簽收會觸發它",
    )
    seq = models.SmallIntegerField("順序")
    label = models.CharField("名稱", max_length=100, help_text="如「第一期請款」")
    trigger_desc = models.CharField(
        "觸發條件", max_length=200, blank=True,
        help_text="合約原文，如「第一期構件全數運抵工地並經業主簽收」",
    )
    percentage = models.DecimalField("比例(%)", max_digits=5, decimal_places=2)
    amount = models.DecimalField(
        "金額", max_digits=14, decimal_places=2, default=Decimal("0"),
        help_text="系統計算＝有效合約額×比例，唯讀",
    )

    # ── 觸發設定（決策 D16）───────────────────────────────────────
    trigger_type = models.CharField(
        "觸發方式", max_length=20, choices=TriggerType.choices, default=TriggerType.MANUAL,
    )
    threshold_pct = models.DecimalField(
        "門檻(%)", max_digits=5, decimal_places=2, null=True, blank=True,
        help_text="觸發方式為「累計重量達門檻」時必填。如 80 表示該期累計簽收噸數達 80%",
    )
    target_location = models.ForeignKey(
        "inventory.Location", verbose_name="指定交貨地點",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="target_milestones",
        help_text="合約指定的施工案場／業主廠房。簽收地點不符時警告但不阻擋",
    )

    # ── 分母鎖定（決策 D20）───────────────────────────────────────
    weight_basis_kg = models.DecimalField(
        "鎖定分母(kg)", max_digits=12, decimal_places=2, null=True, blank=True,
        help_text="首次觸發時把該期所有批次的總重量固化。之後新增批次不影響已算過的比例",
    )
    weight_basis_locked_at = models.DateTimeField("分母鎖定時間", null=True, blank=True)
    weight_basis_changed_by_co = models.ForeignKey(
        "projects.ChangeOrder", verbose_name="分母變更依據",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="unlocked_milestones",
        help_text="要修改已鎖定的分母，必須綁一張【已核准】的變更追加單",
    )

    # ── 累計金額（由 BillingClaim 推導）───────────────────────────
    claimable_amount = models.DecimalField("累計可請金額", max_digits=14, decimal_places=2, default=Decimal("0"))
    claimed_amount = models.DecimalField("累計已請金額", max_digits=14, decimal_places=2, default=Decimal("0"))
    received_amount = models.DecimalField("累計已收金額", max_digits=14, decimal_places=2, default=Decimal("0"))

    state = models.CharField(
        "彙總狀態", max_length=12, choices=MilestoneState.choices, default=MilestoneState.PENDING,
    )
    claimable_at = models.DateTimeField(
        "首次可請款時間", null=True, blank=True, help_text="用於「可請款逾 7 天未開單」判定",
    )
    note = models.CharField("備註", max_length=300, blank=True)

    history = HistoricalRecords(table_name="billing_billingmilestone_history")

    class Meta:
        db_table = "billing_billingmilestone"
        verbose_name = verbose_name_plural = "請款里程碑"
        ordering = ["project", "seq"]
        constraints = [
            models.UniqueConstraint(fields=["project", "seq"], name="uniq_milestone_project_seq"),
            models.CheckConstraint(
                condition=models.Q(percentage__gte=0) & models.Q(percentage__lte=100),
                name="ck_milestone_pct_range",
            ),
            models.CheckConstraint(
                condition=models.Q(claimed_amount__lte=models.F("claimable_amount")),
                name="ck_milestone_claimed_lte_claimable",
            ),
            models.CheckConstraint(
                condition=models.Q(received_amount__lte=models.F("claimed_amount")),
                name="ck_milestone_received_lte_claimed",
            ),
            models.CheckConstraint(
                condition=~models.Q(trigger_type=TriggerType.WEIGHT_THRESHOLD)
                | models.Q(threshold_pct__isnull=False),
                name="ck_milestone_threshold_required",
            ),
        ]
        indexes = [
            models.Index(fields=["project", "state"]),
            models.Index(fields=["trigger_type", "phase"]),
            models.Index(fields=["state", "claimable_at"]),
        ]

    def __str__(self):
        return f"{self.project.name}·{self.label}"

    def clean(self):
        if self.trigger_type == TriggerType.WEIGHT_THRESHOLD and self.threshold_pct is None:
            raise ValidationError({"threshold_pct": "選擇「累計重量達門檻」時必須填寫門檻百分比"})

    # ── 金額 ───────────────────────────────────────────────────────
    def recalc_amount(self, save=True):
        """依有效合約額重算金額。變更單核准時會連帶呼叫。"""
        self.amount = (self.project.effective_amount * self.percentage / 100).quantize(Decimal("0.01"))
        if save:
            self.save(update_fields=["amount", "updated_at"])
        return self.amount

    @property
    def outstanding_amount(self):
        """尚未收款的金額"""
        return self.amount - self.received_amount

    # ── 分母鎖定 ───────────────────────────────────────────────────
    @property
    def is_weight_basis_locked(self):
        return self.weight_basis_locked_at is not None

    def compute_current_weight_basis(self):
        """該期所有批次的總重量合計（未鎖定時的即時值）"""
        from main.apps.tracking.models import TrackingUnit

        qs = TrackingUnit.objects.filter(project=self.project)
        if self.phase_id:
            qs = qs.filter(phase=self.phase)
        agg = qs.aggregate(total=models.Sum("total_weight_kg"))
        return agg["total"] or Decimal("0")

    @property
    def effective_weight_basis(self):
        """實際用於計算的分母：鎖定後用快照，未鎖定時即時計算"""
        return self.weight_basis_kg if self.is_weight_basis_locked else self.compute_current_weight_basis()
