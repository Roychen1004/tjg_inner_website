from decimal import Decimal

from django.conf import settings
from django.db import models
from simple_history.models import HistoricalRecords

from main.apps.core.models import ImmutableLogModel
from main.utils.choices import ClaimSource, ClaimState


class BillingClaimQuerySet(models.QuerySet):
    def claimable(self):
        return self.filter(state=ClaimState.CLAIMABLE)

    def unpaid(self):
        return self.exclude(state=ClaimState.RECEIVED)


class BillingClaim(models.Model):
    """請款事件 —— 實際請款層

    一筆「可以去請這麼多錢了」的事實。
    · manual／all_signed／weight_threshold → 一個里程碑對一筆
    · per_batch                            → 一個里程碑對多筆（每批各一）

    P2 的應收帳款直接接這張表。
    """

    milestone = models.ForeignKey(
        "billing.BillingMilestone", verbose_name="請款里程碑",
        on_delete=models.CASCADE, related_name="claims",
    )
    seq = models.SmallIntegerField("序號")
    amount = models.DecimalField(
        "金額", max_digits=14, decimal_places=2,
        help_text="單位：元。分批請款時＝里程碑金額×(該批噸數÷該期總噸數)",
    )
    source = models.CharField("來源", max_length=20, choices=ClaimSource.choices)
    triggered_by_unit = models.ForeignKey(
        "tracking.TrackingUnit", verbose_name="觸發來源批次",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="triggered_claims",
    )

    state = models.CharField(
        "狀態", max_length=12, choices=ClaimState.choices, default=ClaimState.CLAIMABLE,
    )
    claimable_at = models.DateTimeField("可請款時間", auto_now_add=True)
    invoice_date = models.DateField("請款日", null=True, blank=True)
    invoice_no = models.CharField("請款單號", max_length=30, blank=True)
    receive_date = models.DateField("收款日", null=True, blank=True)

    weight_kg_snapshot = models.DecimalField(
        "噸數快照", max_digits=12, decimal_places=2, null=True, blank=True,
        help_text="產生當時該批的重量，供日後對帳",
    )
    note = models.CharField("備註", max_length=300, blank=True)

    history = HistoricalRecords(table_name="billing_billingclaim_history")
    objects = BillingClaimQuerySet.as_manager()

    class Meta:
        db_table = "billing_billingclaim"
        verbose_name = verbose_name_plural = "請款事件"
        ordering = ["milestone", "seq"]
        constraints = [
            models.UniqueConstraint(fields=["milestone", "seq"], name="uniq_claim_milestone_seq"),
            models.CheckConstraint(condition=models.Q(amount__gt=0), name="ck_claim_amount_positive"),
            models.CheckConstraint(
                condition=models.Q(receive_date__isnull=True)
                | models.Q(invoice_date__isnull=True)
                | models.Q(receive_date__gte=models.F("invoice_date")),
                name="ck_claim_receive_after_invoice",
            ),
        ]
        indexes = [
            models.Index(fields=["milestone", "state"]),
            models.Index(fields=["state", "claimable_at"]),
            models.Index(fields=["state", "invoice_date"]),
            models.Index(fields=["triggered_by_unit"]),
        ]

    def __str__(self):
        return f"{self.milestone.label} #{self.seq}　{self.amount:,.0f} 元"

    @property
    def is_auto(self):
        return self.source == ClaimSource.AUTO_SIGNOFF

    def save(self, *args, **kwargs):
        if not self.seq:
            last = BillingClaim.objects.filter(milestone=self.milestone).order_by("-seq").first()
            self.seq = (last.seq + 1) if last else 1
        super().save(*args, **kwargs)


class BillingClaimLog(ImmutableLogModel):
    """請款狀態異動歷程（不可變）"""

    claim = models.ForeignKey(
        BillingClaim, verbose_name="請款事件", on_delete=models.CASCADE, related_name="logs",
    )
    from_state = models.CharField("原狀態", max_length=12, blank=True)
    to_state = models.CharField("新狀態", max_length=12)
    reason = models.CharField("原因", max_length=500, blank=True, help_text="往回轉時必填")
    is_auto = models.BooleanField("系統自動", default=False)
    amount_snapshot = models.DecimalField("金額快照", max_digits=14, decimal_places=2, default=Decimal("0"))

    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, verbose_name="操作者",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="billing_changes",
    )
    changed_at = models.DateTimeField("異動時間", auto_now_add=True)

    class Meta:
        db_table = "billing_billingclaimlog"
        verbose_name = verbose_name_plural = "請款狀態歷程"
        ordering = ["-changed_at"]
        indexes = [models.Index(fields=["claim", "-changed_at"])]

    def __str__(self):
        return f"{self.claim}：{self.from_state or '（建立）'} → {self.to_state}"
