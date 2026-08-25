from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone
from simple_history.models import HistoricalRecords

from main.apps.core.models import ImmutableLogModel, TimeStampedModel
from main.utils.choices import PayableState, PaymentMethod, SubcontractCategory

#: 營業稅率。台灣加值型營業稅 5%。
#: 合約談的是未稅，但實際進出的錢是含稅——現金流一律用含稅（決策 D31／B2）。
TAX_RATE = Decimal("0.05")


class PayableQuerySet(models.QuerySet):
    def unpaid(self):
        return self.exclude(state=PayableState.PAID)

    def due_between(self, start, end):
        """依**實際會出錢的那一天**篩選，不是預計付款日。

        支票的差別就在這裡：開票日是 due_date，兌現日是 check_due_date。
        中間可能隔 60–90 天，用錯欄位現金流會早算兩三個月。
        """
        from django.db.models.functions import Coalesce

        return self.annotate(
            _cash_date=Coalesce("check_due_date", "due_date")
        ).filter(_cash_date__gte=start, _cash_date__lte=end)


class Payable(TimeStampedModel):
    """應付款項 —— 實際要付出去的一筆錢

    跟應收款（BillingMilestone）對稱，只是方向相反：
        可請款 → 已請款 → 已收款
        待計價 → 已核可 → 已付款

    ⚠️ 金額欄位一律存**未稅**，`payable_amount` 才是實際會匯出去的數字。
    合約談未稅、發票開含稅，兩邊混用就是 5% 的系統性誤差。
    """

    subcontract = models.ForeignKey(
        "payables.Subcontract", verbose_name="分包合約",
        on_delete=models.PROTECT, null=True, blank=True, related_name="payables",
        help_text="可空——零星運費、小額採購不必先開合約",
    )
    project = models.ForeignKey(
        "projects.Project", verbose_name="專案",
        on_delete=models.PROTECT, related_name="payables",
    )
    flow_unit = models.ForeignKey(
        "tracking.FlowUnit", verbose_name="所屬流程",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="payables",
        help_text="這筆錢是為了哪件事花的——訂料款掛「訂料與採購」、"
                  "表處委外款掛「表面處理」。追蹤單元的花錢內容由此對回來",
    )
    vendor = models.ForeignKey(
        "masters.Vendor", verbose_name="廠商",
        on_delete=models.PROTECT, related_name="payables",
    )
    category = models.CharField("類別", max_length=20, choices=SubcontractCategory.choices)
    title = models.CharField("項目", max_length=200, help_text="如「第三期計價」「2月份鋼材」")

    # ── 金額 ───────────────────────────────────────────────────────
    amount = models.DecimalField("未稅金額", max_digits=14, decimal_places=2)
    tax_amount = models.DecimalField(
        "稅額", max_digits=14, decimal_places=2, null=True, blank=True,
        help_text="留空＝系統依 5% 自動算。免稅、零稅率請明確填 0——"
                  "「沒填」與「填 0」是兩件事，不能用同一個值表示",
    )
    retention_amount = models.DecimalField(
        "本次保留款", max_digits=14, decimal_places=2, default=Decimal("0"),
        help_text="依合約的保留款比例自動帶入，可覆寫",
    )
    payable_amount = models.DecimalField(
        "實付金額", max_digits=14, decimal_places=2, default=Decimal("0"),
        help_text="未稅 ＋ 稅額 − 保留款。這才是實際會匯出去的數字，由系統計算",
    )

    # ── 狀態與日期 ─────────────────────────────────────────────────
    state = models.CharField(
        "狀態", max_length=12, choices=PayableState.choices, default=PayableState.PENDING,
    )
    billing_date = models.DateField(
        "計價日", null=True, blank=True, help_text="包商送單／驗收的日期，付款日由此起算",
    )
    due_date = models.DateField(
        "預計付款日", null=True, blank=True, help_text="由付款條件推算，可覆寫",
    )
    approved_at = models.DateTimeField("核可時間", null=True, blank=True)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, verbose_name="核可者",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="approved_payables",
    )
    paid_date = models.DateField("實際付款日", null=True, blank=True)

    payment_method = models.CharField(
        "付款方式", max_length=12, choices=PaymentMethod.choices, default=PaymentMethod.TRANSFER,
    )
    check_due_date = models.DateField(
        "支票到期日", null=True, blank=True,
        help_text="⚠️ 開票日不等於兌現日。填了這欄，現金流就用它算——"
                  "不填的話，錢會被算成提早兩三個月流出（決策 D31／B1）",
    )
    check_no = models.CharField("票號", max_length=30, blank=True)

    invoice_no = models.CharField("發票號碼", max_length=30, blank=True)
    note = models.CharField("備註", max_length=500, blank=True)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, verbose_name="建立者",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="created_payables",
    )

    history = HistoricalRecords(table_name="payables_payable_history")
    objects = PayableQuerySet.as_manager()

    class Meta:
        db_table = "payables_payable"
        verbose_name = verbose_name_plural = "應付款項"
        ordering = ["due_date", "-created_at"]
        constraints = [
            models.CheckConstraint(condition=models.Q(amount__gt=0), name="ck_payable_amount_positive"),
            models.CheckConstraint(
                condition=models.Q(retention_amount__gte=0), name="ck_payable_retention_positive",
            ),
            models.CheckConstraint(
                condition=models.Q(paid_date__isnull=True)
                | models.Q(billing_date__isnull=True)
                | models.Q(paid_date__gte=models.F("billing_date")),
                name="ck_payable_paid_after_billing",
            ),
        ]
        indexes = [
            models.Index(fields=["project", "state"]),
            models.Index(fields=["state", "due_date"]),
            models.Index(fields=["vendor", "state"]),
            models.Index(fields=["subcontract"]),
            models.Index(fields=["check_due_date"]),
        ]

    def __str__(self):
        return f"{self.vendor.name}·{self.title}　{self.payable_amount:,.0f} 元"

    def clean(self):
        if self.subcontract_id and self.project_id and self.subcontract.project_id != self.project_id:
            raise ValidationError({"subcontract": "分包合約不屬於這個專案"})
        if self.flow_unit_id and self.project_id and self.flow_unit.project_id != self.project_id:
            raise ValidationError({"flow_unit": "流程單元不屬於這個專案"})
        if self.retention_amount and self.retention_amount > self.amount:
            raise ValidationError({"retention_amount": "保留款不能超過本次計價金額"})
        if self.payment_method == PaymentMethod.CHECK and self.check_due_date and self.due_date:
            if self.check_due_date < self.due_date:
                raise ValidationError({"check_due_date": "支票到期日不會早於開票日"})

    # ── 金額 ───────────────────────────────────────────────────────
    @property
    def cash_date(self):
        """錢**實際**離開帳戶的那一天。

        現金流只認這個日期。匯款＝預計付款日；支票＝票期到的那天。
        """
        return self.check_due_date or self.due_date

    @property
    def is_overdue(self):
        return bool(
            self.state != PayableState.PAID
            and self.due_date
            and self.due_date < timezone.localdate()
        )

    def recalc_amounts(self):
        """實付金額＝金額－保留款。

        D48（老闆確認）：**所有金額一律填稅後**，系統不再自動加 5%——
        `tax_amount` 沒填就當 0。舊資料填過稅額的照舊尊重，數字不動。
        """
        if self.tax_amount is None:
            self.tax_amount = Decimal("0")
        self.payable_amount = self.amount + self.tax_amount - (self.retention_amount or Decimal("0"))
        return self.payable_amount

    def save(self, *args, **kwargs):
        self.recalc_amounts()
        super().save(*args, **kwargs)


class PayableLog(ImmutableLogModel):
    """應付狀態異動歷程（不可變）。跟應收款的 MilestoneLog 對稱。

    錢的狀態被改過而沒有人知道，是查帳時最麻煩的事。
    """

    payable = models.ForeignKey(
        Payable, verbose_name="應付款項", on_delete=models.CASCADE, related_name="logs",
    )
    from_state = models.CharField("原狀態", max_length=12, blank=True)
    to_state = models.CharField("新狀態", max_length=12)
    reason = models.CharField("原因", max_length=500, blank=True, help_text="往回轉時必填")
    amount_snapshot = models.DecimalField("金額快照", max_digits=14, decimal_places=2, default=Decimal("0"))

    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, verbose_name="操作者",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="payable_changes",
    )
    changed_at = models.DateTimeField("異動時間", auto_now_add=True)

    class Meta:
        db_table = "payables_payablelog"
        verbose_name = verbose_name_plural = "應付狀態歷程"
        ordering = ["-changed_at"]
        indexes = [models.Index(fields=["payable", "-changed_at"])]

    def __str__(self):
        return f"{self.payable}：{self.from_state or '（建立）'} → {self.to_state}"
