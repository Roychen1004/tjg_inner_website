"""公司現有現金（D49 第 5 點）

老闆要的是：在現金流預測頁填一個「公司目前剩多少現金」，
累計列就從這個數字起算——跌破零的那一格才是真正要調頭寸的時候。

只有一列（singleton）。**只有經理與系統管理員看得到、改得到**——
連會計師都不給看：這是公司底牌，不是專案數字。
"""
from decimal import Decimal

from django.conf import settings
from django.db import models


class CashBalance(models.Model):
    amount = models.DecimalField("現有現金", max_digits=14, decimal_places=0, default=Decimal("0"))
    note = models.CharField("備註", max_length=200, blank=True)
    updated_at = models.DateTimeField("更新時間", auto_now=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, verbose_name="更新人",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
    )

    class Meta:
        db_table = "payables_cashbalance"
        verbose_name = verbose_name_plural = "公司現有現金"

    def __str__(self):
        return f"現有現金 {self.amount:,.0f} 元"

    @classmethod
    def get(cls):
        obj = cls.objects.order_by("id").first()
        return obj or cls.objects.create(amount=Decimal("0"))
