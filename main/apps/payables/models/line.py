from decimal import Decimal

from django.db import models

from main.apps.core.models import TimeStampedModel


class PayableLine(TimeStampedModel):
    """應付明細（D52）——一張應付款拆多列品項，材料單價統計的來源

    例：「2月份鋼材」一張單拆成 鋼材 3.2噸×48,000 ＋ 螺栓 500支×12。
    明細**選填**：零星款照舊只填總額；有明細時應付款金額自動＝明細合計
    （D48 起金額一律稅後，明細單價也是稅後）。
    """

    payable = models.ForeignKey(
        "payables.Payable", verbose_name="應付款項",
        on_delete=models.CASCADE, related_name="lines",
    )
    item = models.ForeignKey(
        "masters.MaterialItem", verbose_name="品項",
        on_delete=models.PROTECT, related_name="payable_lines",
    )
    qty = models.DecimalField("數量", max_digits=12, decimal_places=2)
    unit_price = models.DecimalField("單價", max_digits=14, decimal_places=2)
    amount = models.DecimalField(
        "金額", max_digits=14, decimal_places=2, default=Decimal("0"),
        help_text="數量 × 單價，由系統計算",
    )

    class Meta:
        db_table = "payables_payableline"
        verbose_name = verbose_name_plural = "應付明細"
        ordering = ["id"]
        constraints = [
            models.CheckConstraint(condition=models.Q(qty__gt=0), name="ck_payline_qty_positive"),
            models.CheckConstraint(
                condition=models.Q(unit_price__gte=0), name="ck_payline_price_positive",
            ),
        ]
        indexes = [models.Index(fields=["item"])]

    def save(self, *args, **kwargs):
        self.amount = (self.qty * self.unit_price).quantize(Decimal("0.01"))
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.item.name}　{self.qty:g} × {self.unit_price:,.0f}"
