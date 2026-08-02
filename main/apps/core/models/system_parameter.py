from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone


class SystemParameterQuerySet(models.QuerySet):
    def effective_on(self, on_date=None):
        on_date = on_date or timezone.localdate()
        return self.filter(
            models.Q(effective_from__lte=on_date),
            models.Q(effective_to__isnull=True) | models.Q(effective_to__gt=on_date),
        )


class SystemParameter(models.Model):
    """可設定的系統常數（費用率、附加率、逾期天數…）

    ⚠️ 帶生效日期是刻意的。手冊 13.5 把「費用率不更新」列為三大核算陷阱之一，
    但更新後又不能讓歷史訂單的成本跟著變——2026 年的訂單必須用 2026 年的
    製造費用率核算。所以查詢時一律指定日期，取當時有效的那一筆。
    """

    code = models.CharField("參數代號", max_length=50)
    name = models.CharField("名稱", max_length=100)
    value = models.DecimalField("數值", max_digits=18, decimal_places=6)
    unit = models.CharField("單位", max_length=20, blank=True)

    effective_from = models.DateField("生效日")
    effective_to = models.DateField("失效日", null=True, blank=True, help_text="留空表示仍有效")
    source_note = models.TextField("依據說明", blank=True)

    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, verbose_name="更新者",
        on_delete=models.SET_NULL, null=True, blank=True,
    )
    updated_at = models.DateTimeField("更新時間", auto_now=True)

    objects = SystemParameterQuerySet.as_manager()

    class Meta:
        db_table = "core_systemparameter"
        verbose_name = verbose_name_plural = "系統參數"
        ordering = ["code", "-effective_from"]
        constraints = [
            models.UniqueConstraint(fields=["code", "effective_from"], name="uniq_param_code_from"),
            models.CheckConstraint(
                condition=models.Q(effective_to__isnull=True)
                | models.Q(effective_to__gt=models.F("effective_from")),
                name="ck_param_period_valid",
            ),
        ]

    def __str__(self):
        return f"{self.name}＝{self.value}{self.unit}（{self.effective_from} 起）"

    def clean(self):
        if self.effective_to and self.effective_to <= self.effective_from:
            raise ValidationError({"effective_to": "失效日必須晚於生效日"})

    # ── 查詢 ───────────────────────────────────────────────────────
    @classmethod
    def get(cls, code, on_date=None, default=None):
        """取指定日期有效的參數值。找不到時回傳 default 或 settings 的預設。"""
        param = (
            cls.objects.effective_on(on_date)
            .filter(code=code)
            .order_by("-effective_from")
            .first()
        )
        if param:
            return param.value
        if default is not None:
            return Decimal(str(default))
        fallback = getattr(settings, code.upper(), None)
        return Decimal(str(fallback)) if fallback is not None else None

    @classmethod
    def get_int(cls, code, on_date=None, default=None):
        value = cls.get(code, on_date, default)
        return int(value) if value is not None else None
