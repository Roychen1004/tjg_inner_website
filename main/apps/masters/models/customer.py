from django.db import models
from simple_history.models import HistoricalRecords

from main.apps.core.models import TimeStampedModel
from main.utils.choices import PaymentTermType


class Customer(TimeStampedModel):
    """客戶（業主）"""

    code = models.CharField("客戶代號", max_length=20, unique=True)
    name = models.CharField("客戶名稱", max_length=100)
    tax_id = models.CharField("統一編號", max_length=8, blank=True)
    contact_name = models.CharField("聯絡人", max_length=50, blank=True)
    contact_phone = models.CharField("聯絡電話", max_length=30, blank=True)
    address = models.CharField("地址", max_length=200, blank=True)

    # ── 帳期（現金流預測的來源）───────────────────────────────────
    # 沒有這兩欄就推不出「錢哪天會到」，收款側的現金流只能是一片空白
    payment_term_type = models.CharField(
        "付款條件", max_length=20, choices=PaymentTermType.choices,
        default=PaymentTermType.MONTH_END,
    )
    payment_term_days = models.SmallIntegerField(
        "帳期天數", default=60,
        help_text="常見 30／60／90。月結是「請款當月月底再加這些天」，不是從請款日起算",
    )

    note = models.TextField("備註", blank=True)
    is_active = models.BooleanField("啟用中", default=True)

    history = HistoricalRecords(table_name="masters_customer_history")

    class Meta:
        db_table = "masters_customer"
        verbose_name = verbose_name_plural = "客戶"
        ordering = ["code"]

    def __str__(self):
        return self.name
