from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone
from simple_history.models import HistoricalRecords

from main.apps.core.models import TimeStampedModel
from main.utils.choices import AGING_THRESHOLDS, AgingStatus, LotStatus


class LotQuerySet(models.QuerySet):
    def available(self):
        return self.filter(status=LotStatus.AVAILABLE, qty_on_hand__gt=0)

    def remnants(self):
        return self.filter(is_remnant=True, qty_on_hand__gt=0)

    def stagnant(self):
        return self.filter(
            aging_status__in=[AgingStatus.STAGNANT, AgingStatus.DEAD, AgingStatus.SCRAP_CANDIDATE]
        )

    def for_project(self, project):
        return self.filter(reserved_for_project=project)


class Lot(TimeStampedModel):
    """批號庫存（數量型物品：建材、零件耗材）

    餘料是鋼構特有的：切割後的料頭仍然值錢，且直接影響材料利用率 KPI
    （手冊目標 85%）。is_remnant 的批號會記錄實際剩餘尺寸，
    「找料」功能據此媒合，避免開新料。
    """

    lot_no = models.CharField("批號", max_length=40, unique=True)
    item = models.ForeignKey(
        "masters.Item", verbose_name="物品", on_delete=models.PROTECT, related_name="lots",
    )
    location = models.ForeignKey(
        "inventory.Location", verbose_name="目前位置",
        on_delete=models.PROTECT, related_name="lots",
    )

    qty_on_hand = models.DecimalField("現有量", max_digits=12, decimal_places=2, default=Decimal("0"))
    qty_reserved = models.DecimalField("已預留量", max_digits=12, decimal_places=2, default=Decimal("0"))
    unit_cost = models.DecimalField("單位成本", max_digits=12, decimal_places=2, null=True, blank=True)
    total_value = models.DecimalField("帳面價值", max_digits=14, decimal_places=2, null=True, blank=True)

    status = models.CharField(
        "狀態", max_length=20, choices=LotStatus.choices, default=LotStatus.QUARANTINE,
    )
    reserved_for_project = models.ForeignKey(
        "projects.Project", verbose_name="預留給專案",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="reserved_lots",
    )

    received_date = models.DateField("入庫日", null=True, blank=True)
    last_move_date = models.DateField("最後異動日", null=True, blank=True, help_text="庫齡計算基準")
    aging_status = models.CharField(
        "庫齡狀態", max_length=20, choices=AgingStatus.choices, default=AgingStatus.NORMAL,
    )

    source_po_no = models.CharField("來源採購單", max_length=30, blank=True)
    mill_cert_no = models.CharField("材質證明編號", max_length=50, blank=True)
    heat_no = models.CharField("爐號", max_length=30, blank=True, help_text="鋼材追溯用")

    # ── 餘料 ───────────────────────────────────────────────────────
    is_remnant = models.BooleanField("餘料", default=False, help_text="切割後剩下的料頭")
    parent_lot = models.ForeignKey(
        "self", verbose_name="來源批號", on_delete=models.PROTECT,
        null=True, blank=True, related_name="remnants",
        help_text="餘料必填，可追溯回原始材質證明",
    )
    # ⚠️ 這裡是 PROTECT 而非 SET_NULL：餘料的材質證明來自母批號，
    # 母批號被刪掉就切斷了追溯鏈。而且 SET_NULL 會讓 parent_lot 變 NULL，
    # 直接違反下方的 ck_lot_remnant_needs_parent 約束。
    actual_length_mm = models.DecimalField(
        "實際長度(mm)", max_digits=10, decimal_places=2, null=True, blank=True,
        help_text="餘料的實際剩餘尺寸，「找料」查詢用",
    )
    actual_width_mm = models.DecimalField(
        "實際寬度(mm)", max_digits=10, decimal_places=2, null=True, blank=True,
    )

    note = models.CharField("備註", max_length=300, blank=True)

    history = HistoricalRecords(table_name="inventory_lot_history")
    objects = LotQuerySet.as_manager()

    class Meta:
        db_table = "inventory_lot"
        verbose_name = verbose_name_plural = "批號庫存"
        ordering = ["item", "lot_no"]
        constraints = [
            models.CheckConstraint(condition=models.Q(qty_on_hand__gte=0), name="ck_lot_qty_nonneg"),
            models.CheckConstraint(
                condition=models.Q(qty_reserved__gte=0)
                & models.Q(qty_reserved__lte=models.F("qty_on_hand")),
                name="ck_lot_reserved_lte_onhand",
            ),
            models.CheckConstraint(
                condition=models.Q(is_remnant=False) | models.Q(parent_lot__isnull=False),
                name="ck_lot_remnant_needs_parent",
            ),
        ]
        indexes = [
            models.Index(fields=["item", "status"]),
            models.Index(fields=["location"]),
            models.Index(fields=["reserved_for_project"]),
            models.Index(fields=["aging_status", "last_move_date"]),
            # 找餘料只掃餘料，不掃全部庫存
            models.Index(
                fields=["is_remnant", "actual_length_mm"],
                condition=models.Q(is_remnant=True),
                name="idx_lot_remnant_search",
            ),
        ]

    def __str__(self):
        return f"{self.lot_no}　{self.item.name}"

    @property
    def qty_available(self):
        return self.qty_on_hand - self.qty_reserved

    @property
    def aging_days(self):
        base = self.last_move_date or self.received_date
        return (timezone.localdate() - base).days if base else 0

    @property
    def total_weight_kg(self):
        if self.item.unit_weight_kg is None:
            return None
        return self.qty_on_hand * self.item.unit_weight_kg

    def compute_aging_status(self):
        days = self.aging_days
        for threshold, status in AGING_THRESHOLDS:
            if days >= threshold:
                return status
        return AgingStatus.NORMAL

    def clean(self):
        if self.is_remnant and not self.parent_lot_id:
            raise ValidationError({"parent_lot": "餘料必須指定來源批號"})
