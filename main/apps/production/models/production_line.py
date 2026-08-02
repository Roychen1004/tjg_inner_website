from decimal import Decimal

from django.conf import settings
from django.db import models

from main.utils.choices import LineStatus


class ProductionLine(models.Model):
    """產線

    P1 為簡易版：稼動率人工填寫。
    P3 導入報工與 OEE 後改為自動計算（手冊第 17 章）。
    """

    code = models.CharField("產線代號", max_length=20, unique=True)
    name = models.CharField("產線名稱", max_length=50, help_text="如「雷射切割線 (HSG TLS)」")
    status = models.CharField("狀態", max_length=12, choices=LineStatus.choices, default=LineStatus.IDLE)
    current_work = models.CharField(
        "當前工單", max_length=100, blank=True, help_text="P1 為純文字，P3 改為關聯工單",
    )
    utilization = models.DecimalField(
        "稼動率(%)", max_digits=5, decimal_places=2, default=Decimal("0"),
        help_text="P1 人工填寫，P3 由報工資料自動計算 OEE",
    )
    today_output = models.CharField("今日產出", max_length=50, blank=True)
    sort_order = models.SmallIntegerField("顯示順序", default=0)
    is_active = models.BooleanField("啟用中", default=True)

    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, verbose_name="更新者",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="updated_lines",
    )
    updated_at = models.DateTimeField("更新時間", auto_now=True)

    class Meta:
        db_table = "production_productionline"
        verbose_name = verbose_name_plural = "產線"
        ordering = ["sort_order", "code"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(utilization__gte=0) & models.Q(utilization__lte=100),
                name="ck_line_utilization_range",
            ),
        ]

    def __str__(self):
        return self.name
