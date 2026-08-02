from django.db import models
from simple_history.models import HistoricalRecords

from main.apps.core.models import TimeStampedModel
from main.utils.choices import (
    PROFILE_DIMENSION_FIELDS,
    ItemKind,
    ProfileType,
    SurfaceTreatment,
    TrackingMode,
)


class ItemCategory(models.Model):
    """物品分類（樹狀）"""

    code = models.CharField("分類代號", max_length=30, unique=True)
    name = models.CharField("分類名稱", max_length=50)
    parent = models.ForeignKey(
        "self", verbose_name="上層分類", on_delete=models.SET_NULL,
        null=True, blank=True, related_name="children",
    )
    item_kind = models.CharField("物品類型", max_length=20, choices=ItemKind.choices)
    sort_order = models.SmallIntegerField("顯示順序", default=0)
    is_active = models.BooleanField("啟用中", default=True)

    class Meta:
        db_table = "masters_itemcategory"
        verbose_name = verbose_name_plural = "物品分類"
        ordering = ["item_kind", "sort_order", "code"]

    def __str__(self):
        return f"{self.parent.name} / {self.name}" if self.parent else self.name


class ItemQuerySet(models.QuerySet):
    def active(self):
        return self.filter(is_active=True)

    def quantity_tracked(self):
        return self.filter(tracking_mode=TrackingMode.QUANTITY)

    def individually_tracked(self):
        return self.filter(tracking_mode=TrackingMode.INDIVIDUAL)


class Item(TimeStampedModel):
    """物品主檔：建材／零件耗材／工具／設備

    尺寸用固定欄位而非 JSON，因為要能搜尋「6mm 的 SS400 鋼板還有沒有」。
    不同料型只會用到其中幾個欄位，Admin 表單依 profile_type 只顯示相關的
    （見 PROFILE_DIMENSION_FIELDS）。
    """

    code = models.CharField("料號", max_length=30, unique=True)
    name = models.CharField("品名", max_length=150)
    category = models.ForeignKey(
        ItemCategory, verbose_name="分類", on_delete=models.PROTECT, related_name="items",
    )
    item_kind = models.CharField("物品類型", max_length=20, choices=ItemKind.choices)
    tracking_mode = models.CharField(
        "追蹤方式", max_length=20, choices=TrackingMode.choices,
        help_text="數量型用批號管（問還剩多少）；個體型一物一筆（問在誰手上）",
    )
    unit_of_measure = models.CharField("單位", max_length=10, help_text="支／張／組／kg／噸／件")

    # ── 建材規格 ───────────────────────────────────────────────────
    profile_type = models.CharField(
        "料型", max_length=20, choices=ProfileType.choices, blank=True,
        help_text="決定要填哪些尺寸欄位",
    )
    spec_label = models.CharField(
        "規格標示", max_length=100, blank=True,
        help_text="完整規格，如 H400×200×8×13。可由尺寸自動組出，也可手改",
    )
    material_grade = models.CharField(
        "材質", max_length=30, blank=True, help_text="SS400／SN490B／A36／A572／SD420W",
    )
    standard = models.CharField("標準", max_length=20, blank=True, help_text="CNS／JIS／ASTM")

    thickness_mm = models.DecimalField("厚度(mm)", max_digits=8, decimal_places=2, null=True, blank=True)
    width_mm = models.DecimalField("寬／翼板寬(mm)", max_digits=8, decimal_places=2, null=True, blank=True)
    height_mm = models.DecimalField("高／腹板高(mm)", max_digits=8, decimal_places=2, null=True, blank=True)
    length_mm = models.DecimalField("長度(mm)", max_digits=10, decimal_places=2, null=True, blank=True)
    diameter_mm = models.DecimalField("外徑／直徑(mm)", max_digits=8, decimal_places=2, null=True, blank=True)
    web_thickness_mm = models.DecimalField("腹板厚(mm)", max_digits=8, decimal_places=2, null=True, blank=True)
    flange_thickness_mm = models.DecimalField("翼板厚(mm)", max_digits=8, decimal_places=2, null=True, blank=True)

    unit_weight_kg = models.DecimalField(
        "單位重量(kg)", max_digits=10, decimal_places=3, null=True, blank=True,
        help_text="kg/支 或 kg/m。鋼構論噸計費必備，系統據此自動算總噸數與裝載率",
    )
    surface_treatment = models.CharField(
        "表面處理", max_length=20, choices=SurfaceTreatment.choices,
        default=SurfaceTreatment.RAW, blank=True,
    )
    requires_mill_cert = models.BooleanField(
        "需材質證明", default=False, help_text="公共工程通常必要",
    )

    # ── 庫存管理 ───────────────────────────────────────────────────
    default_location = models.ForeignKey(
        "inventory.Location", verbose_name="預設存放位置",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="default_items",
    )
    safety_stock = models.DecimalField(
        "安全存量", max_digits=12, decimal_places=2, null=True, blank=True,
        help_text="低於此值時警示採購",
    )
    standard_cost = models.DecimalField(
        "標準單價", max_digits=12, decimal_places=2, null=True, blank=True,
        help_text="單位：新台幣元。成本核算用",
    )
    preferred_vendor = models.ForeignKey(
        "masters.Vendor", verbose_name="慣用供應商",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="preferred_items",
    )

    photo = models.CharField("照片路徑", max_length=300, blank=True)
    note = models.TextField("備註", blank=True)
    is_active = models.BooleanField("啟用中", default=True)

    history = HistoricalRecords(table_name="masters_item_history")
    objects = ItemQuerySet.as_manager()

    class Meta:
        db_table = "masters_item"
        verbose_name = verbose_name_plural = "物品主檔"
        ordering = ["item_kind", "code"]
        indexes = [
            models.Index(fields=["item_kind", "is_active"]),
            # 找料查詢：「6mm 的 SS400 鋼板還有沒有」
            models.Index(fields=["profile_type", "material_grade", "thickness_mm"],
                         name="idx_item_spec_search"),
        ]

    def __str__(self):
        return f"{self.name} {self.spec_label}".strip()

    @property
    def dimension_fields(self):
        """本料型會用到的尺寸欄位名稱"""
        return PROFILE_DIMENSION_FIELDS.get(self.profile_type, [])

    @property
    def dimensions(self):
        """只回傳有值的尺寸，供 API 輸出"""
        return {
            f: getattr(self, f)
            for f in self.dimension_fields
            if getattr(self, f) is not None
        }

    def build_spec_label(self):
        """依料型自動組出規格標示。使用者仍可手動覆寫。"""
        d = {f: getattr(self, f) for f in self.dimension_fields}

        def num(v):
            if v is None:
                return ""
            return str(int(v)) if v == int(v) else str(v)

        p = self.profile_type
        if p == ProfileType.PLATE:
            return f"{num(d.get('thickness_mm'))}t × {num(d.get('width_mm'))} × {num(d.get('length_mm'))}"
        if p == ProfileType.H_BEAM:
            base = (f"H{num(d.get('height_mm'))}×{num(d.get('width_mm'))}"
                    f"×{num(d.get('web_thickness_mm'))}×{num(d.get('flange_thickness_mm'))}")
            return f"{base} L={num(d.get('length_mm'))}" if d.get("length_mm") else base
        if p == ProfileType.ANGLE:
            base = f"L{num(d.get('width_mm'))}×{num(d.get('height_mm'))}×{num(d.get('thickness_mm'))}"
            return f"{base} L={num(d.get('length_mm'))}" if d.get("length_mm") else base
        if p == ProfileType.CHANNEL:
            return f"C{num(d.get('height_mm'))}×{num(d.get('width_mm'))}×{num(d.get('thickness_mm'))}"
        if p == ProfileType.SQ_TUBE:
            base = f"□{num(d.get('width_mm'))}×{num(d.get('height_mm'))}×{num(d.get('thickness_mm'))}t"
            return f"{base} L={num(d.get('length_mm'))}" if d.get("length_mm") else base
        if p == ProfileType.RD_TUBE:
            base = f"Ø{num(d.get('diameter_mm'))}×{num(d.get('thickness_mm'))}t"
            return f"{base} L={num(d.get('length_mm'))}" if d.get("length_mm") else base
        if p == ProfileType.REBAR:
            base = f"D{num(d.get('diameter_mm'))}"
            return f"{base} L={num(d.get('length_mm'))}" if d.get("length_mm") else base
        if p == ProfileType.BOLT:
            return f"M{num(d.get('diameter_mm'))}×{num(d.get('length_mm'))}"
        return self.spec_label

    def save(self, *args, **kwargs):
        if self.profile_type and not self.spec_label:
            self.spec_label = self.build_spec_label()
        super().save(*args, **kwargs)
