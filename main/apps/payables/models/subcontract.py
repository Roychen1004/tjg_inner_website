from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone
from simple_history.models import HistoricalRecords

from main.apps.core.models import TimeStampedModel
from main.utils.choices import (
    PayableState,
    PaymentTermType,
    SubcontractCategory,
    SubcontractStatus,
)


class SubcontractQuerySet(models.QuerySet):
    def active(self):
        return self.filter(status=SubcontractStatus.ACTIVE)

    def with_billed(self):
        """把「這張合約已經計價多少」一次算完。

        用 Subquery 而不是 annotate(Sum)——同時要算兩個不同關聯的總和時，
        兩層 JOIN 會讓列數相乘，兩個金額**都會被放大**（見 ProjectQuerySet.with_amounts）。
        """
        from django.db.models import OuterRef, Subquery
        from django.db.models.functions import Coalesce

        from main.apps.payables.models.payable import Payable

        money = models.DecimalField(max_digits=14, decimal_places=2)

        def summed(**extra):
            return Coalesce(
                Subquery(
                    Payable.objects.filter(subcontract=OuterRef("pk"), **extra)
                    .values("subcontract")
                    .annotate(total=models.Sum("amount"))
                    .values("total"),
                    output_field=money,
                ),
                Decimal("0"),
                output_field=money,
            )

        return self.annotate(_billed_total=summed(), _paid_total=summed(state=PayableState.PAID))


class Subcontract(TimeStampedModel):
    """分包合約 —— 我們要付給別人的那一份合約

    刻意跟 `Project`（業主付我們）對稱：
        Project     → BillingMilestone（應收款）   收款
        Subcontract →                   Payable          付款

    對稱的理由是**少學一套東西**：會計看應付款項的操作邏輯，
    跟看請款事件一模一樣。

    為什麼應付只有兩層、應收有三層：應收之所以要中間那層，是因為
    `per_batch` 觸發時一條里程碑會生出 N 筆錢。應付沒有自動觸發——
    包商送計價單過來，我們建一筆。合約管「總共多少、什麼條件」，
    應付款項管「這次要付多少、哪天付」，兩層就夠。
    """

    code = models.CharField("合約編號", max_length=30, unique=True, help_text="SC-YYYY-NNN，系統產生")
    project = models.ForeignKey(
        "projects.Project", verbose_name="專案",
        on_delete=models.PROTECT, related_name="subcontracts",
        help_text="一定要有——這是算得出專案成本與損益的關鍵",
    )
    vendor = models.ForeignKey(
        "masters.Vendor", verbose_name="廠商",
        on_delete=models.PROTECT, related_name="subcontracts",
    )
    title = models.CharField("合約名稱", max_length=200, help_text="如「B區土建工程」「第一期鋼材採購」")
    category = models.CharField("類別", max_length=20, choices=SubcontractCategory.choices)

    contract_amount = models.DecimalField(
        "合約金額", max_digits=14, decimal_places=2,
        help_text="單位：元，**未稅**。含稅金額由現金流計算時再加（決策 D31／B2）",
    )

    # ── 付款條件 ───────────────────────────────────────────────────
    payment_term_type = models.CharField(
        "付款條件", max_length=20, choices=PaymentTermType.choices,
        default=PaymentTermType.MONTH_END,
    )
    payment_term_days = models.SmallIntegerField(
        "帳期天數", default=30, help_text="常見 30／60／90",
    )
    retention_pct = models.DecimalField(
        "保留款(%)", max_digits=5, decimal_places=2, default=Decimal("0"),
        help_text="每期扣的百分比，驗收合格後退還。"
                  "不算的話每期實付金額會高估 5–10%——500 萬的合約就差 25–50 萬",
    )

    start_date = models.DateField("開始日", null=True, blank=True)
    end_date = models.DateField("預計完成", null=True, blank=True)
    status = models.CharField(
        "狀態", max_length=12, choices=SubcontractStatus.choices, default=SubcontractStatus.ACTIVE,
    )
    note = models.CharField("備註", max_length=500, blank=True)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, verbose_name="建立者",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="created_subcontracts",
    )

    history = HistoricalRecords(table_name="payables_subcontract_history")
    objects = SubcontractQuerySet.as_manager()

    class Meta:
        db_table = "payables_subcontract"
        verbose_name = verbose_name_plural = "分包合約"
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(contract_amount__gte=0), name="ck_subcontract_amount_positive",
            ),
            models.CheckConstraint(
                condition=models.Q(retention_pct__gte=0) & models.Q(retention_pct__lte=100),
                name="ck_subcontract_retention_range",
            ),
            models.CheckConstraint(
                condition=models.Q(payment_term_days__gte=0) & models.Q(payment_term_days__lte=365),
                name="ck_subcontract_term_days_range",
            ),
        ]
        indexes = [
            models.Index(fields=["project", "status"]),
            models.Index(fields=["vendor"]),
        ]

    def __str__(self):
        return f"{self.code} {self.title}"

    def clean(self):
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValidationError({"end_date": "預計完成日不能早於開始日"})

    # ── 金額 ───────────────────────────────────────────────────────
    # 列表用 SubcontractQuerySet.with_billed() 事先算好；單筆存取才自己查。
    @property
    def billed_amount(self):
        """已計價金額（含尚未核可的）"""
        cached = getattr(self, "_billed_total", None)
        if cached is not None:
            return cached
        return self.payables.aggregate(t=models.Sum("amount"))["t"] or Decimal("0")

    @property
    def paid_amount(self):
        cached = getattr(self, "_paid_total", None)
        if cached is not None:
            return cached
        return self.payables.filter(state=PayableState.PAID).aggregate(
            t=models.Sum("amount")
        )["t"] or Decimal("0")

    @property
    def remaining_amount(self):
        """合約還剩多少沒計價。現金流的「預估」那一級就是它均攤出來的"""
        return max(self.contract_amount - self.billed_amount, Decimal("0"))

    @property
    def billed_pct(self):
        if not self.contract_amount:
            return None
        return round(float(self.billed_amount / self.contract_amount * 100), 1)

    @classmethod
    def generate_code(cls):
        year = timezone.localdate().year
        prefix = f"SC-{year}-"
        last = cls.objects.filter(code__startswith=prefix).order_by("-code").first()
        seq = int(last.code.rsplit("-", 1)[1]) + 1 if last else 1
        return f"{prefix}{seq:03d}"

    def save(self, *args, **kwargs):
        if not self.code:
            self.code = self.generate_code()
        super().save(*args, **kwargs)
