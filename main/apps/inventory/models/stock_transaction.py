from django.conf import settings
from django.db import models

from main.apps.core.models import ImmutableLogModel
from main.utils.choices import StockTxnType


class StockTransaction(ImmutableLogModel):
    """庫存異動（不可變）

    ⚠️ tracking_unit 是關鍵串接：領料時指定給哪個構件批次，
    材料成本就自動歸集到那個批次 → 專案 → 完全成本核算（手冊 13.1）。
    沒有這個欄位，成本就只能靠人工分攤。
    """

    lot = models.ForeignKey(
        "inventory.Lot", verbose_name="批號", on_delete=models.PROTECT, related_name="transactions",
    )
    txn_type = models.CharField("異動類型", max_length=20, choices=StockTxnType.choices)
    qty = models.DecimalField("異動量", max_digits=12, decimal_places=2, help_text="正負皆可")
    qty_before = models.DecimalField("異動前結存", max_digits=12, decimal_places=2)
    qty_after = models.DecimalField("異動後結存", max_digits=12, decimal_places=2)

    from_location = models.ForeignKey(
        "inventory.Location", verbose_name="來源位置",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="txn_from",
    )
    to_location = models.ForeignKey(
        "inventory.Location", verbose_name="目的位置",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="txn_to",
    )

    project = models.ForeignKey(
        "projects.Project", verbose_name="領用給專案",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="stock_txns",
    )
    tracking_unit = models.ForeignKey(
        "tracking.TrackingUnit", verbose_name="領用給追蹤單元",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="stock_txns",
        help_text="材料成本自動歸集的關鍵",
    )

    ref_doc_type = models.CharField("來源單據類型", max_length=20, blank=True)
    ref_doc_no = models.CharField("來源單號", max_length=30, blank=True)
    unit_cost = models.DecimalField("單位成本", max_digits=12, decimal_places=2, null=True, blank=True)
    amount = models.DecimalField("金額", max_digits=14, decimal_places=2, null=True, blank=True)

    operator = models.ForeignKey(
        settings.AUTH_USER_MODEL, verbose_name="操作者",
        on_delete=models.SET_NULL, null=True, related_name="stock_txns",
    )
    occurred_at = models.DateTimeField("異動時間", auto_now_add=True, db_index=True)
    note = models.CharField("備註", max_length=300, blank=True)

    class Meta:
        db_table = "inventory_stocktransaction"
        verbose_name = verbose_name_plural = "庫存異動"
        ordering = ["-occurred_at"]
        indexes = [
            models.Index(fields=["lot", "-occurred_at"]),
            models.Index(fields=["project", "occurred_at"]),
            models.Index(fields=["tracking_unit"]),
            models.Index(fields=["txn_type", "occurred_at"]),
        ]

    def __str__(self):
        return f"{self.get_txn_type_display()} {self.lot.lot_no} {self.qty:+}"
