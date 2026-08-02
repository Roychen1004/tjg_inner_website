from django.conf import settings
from django.db import models
from django.utils import timezone
from simple_history.models import HistoricalRecords

from main.apps.core.models import ImmutableLogModel, TimeStampedModel
from main.utils.choices import AssetMovementType, AssetStatus


class AssetUnitQuerySet(models.QuerySet):
    def available(self):
        return self.filter(asset_status=AssetStatus.IDLE, is_active=True)

    def in_use(self):
        return self.filter(asset_status=AssetStatus.IN_USE)

    def calibration_due(self, within_days=14):
        deadline = timezone.localdate() + timezone.timedelta(days=within_days)
        return self.filter(calibration_due_date__isnull=False, calibration_due_date__lte=deadline)

    def maintenance_due(self, within_days=14):
        deadline = timezone.localdate() + timezone.timedelta(days=within_days)
        return self.filter(next_maintenance_date__isnull=False, next_maintenance_date__lte=deadline)


class AssetUnit(TimeStampedModel):
    """個體資產（工具、設備）—— 一物一筆

    與批號庫存的差別：一支電焊機不會「用掉 0.3 支」，但會「歸還」。
    問的問題是「在誰手上」而不是「還剩多少」（決策 D10）。
    """

    asset_no = models.CharField("財產編號", max_length=30, unique=True, help_text="如 TL-0031")
    item = models.ForeignKey(
        "masters.Item", verbose_name="物品", on_delete=models.PROTECT, related_name="asset_units",
    )
    serial_no = models.CharField("製造商序號", max_length=60, blank=True)
    brand = models.CharField("廠牌", max_length=50, blank=True)
    model = models.CharField("型號", max_length=50, blank=True)

    location = models.ForeignKey(
        "inventory.Location", verbose_name="目前位置",
        on_delete=models.PROTECT, related_name="assets",
    )
    holder = models.ForeignKey(
        settings.AUTH_USER_MODEL, verbose_name="目前持有人",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="held_assets",
    )
    asset_status = models.CharField(
        "狀態", max_length=20, choices=AssetStatus.choices, default=AssetStatus.IDLE,
    )
    current_project = models.ForeignKey(
        "projects.Project", verbose_name="目前用於專案",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="assets",
    )

    purchase_date = models.DateField("購置日", null=True, blank=True)
    purchase_cost = models.DecimalField("購置成本", max_digits=12, decimal_places=2, null=True, blank=True)
    depreciation_years = models.SmallIntegerField("折舊年限", null=True, blank=True)
    book_value = models.DecimalField("帳面價值", max_digits=12, decimal_places=2, null=True, blank=True)

    last_maintenance_date = models.DateField("上次保養日", null=True, blank=True)
    next_maintenance_date = models.DateField("下次保養日", null=True, blank=True)
    calibration_due_date = models.DateField(
        "校驗到期日", null=True, blank=True,
        help_text="扭力扳手、量具、吊帶、吊具等需定期校驗的器具",
    )

    photo = models.CharField("照片路徑", max_length=300, blank=True)
    note = models.TextField("備註", blank=True)
    is_active = models.BooleanField("啟用中", default=True)

    history = HistoricalRecords(table_name="assets_assetunit_history")
    objects = AssetUnitQuerySet.as_manager()

    class Meta:
        db_table = "assets_assetunit"
        verbose_name = verbose_name_plural = "個體資產"
        ordering = ["asset_no"]
        indexes = [
            models.Index(fields=["asset_status"]),
            models.Index(fields=["current_project"]),
            models.Index(fields=["holder"]),
            models.Index(fields=["location"]),
            models.Index(fields=["next_maintenance_date"]),
            models.Index(fields=["calibration_due_date"]),
        ]

    def __str__(self):
        return f"{self.asset_no}　{self.item.name}"

    @property
    def is_calibration_overdue(self):
        return bool(self.calibration_due_date and self.calibration_due_date < timezone.localdate())

    @property
    def is_maintenance_overdue(self):
        return bool(self.next_maintenance_date and self.next_maintenance_date < timezone.localdate())


class AssetMovement(ImmutableLogModel):
    """資產異動（不可變）"""

    asset = models.ForeignKey(
        AssetUnit, verbose_name="資產", on_delete=models.CASCADE, related_name="movements",
    )
    movement_type = models.CharField("異動類型", max_length=20, choices=AssetMovementType.choices)

    from_location = models.ForeignKey(
        "inventory.Location", verbose_name="原位置",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="asset_moved_from",
    )
    to_location = models.ForeignKey(
        "inventory.Location", verbose_name="新位置",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="asset_moved_to",
    )
    from_holder = models.ForeignKey(
        settings.AUTH_USER_MODEL, verbose_name="原持有人",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="asset_handed_out",
    )
    to_holder = models.ForeignKey(
        settings.AUTH_USER_MODEL, verbose_name="新持有人",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="asset_received",
    )
    from_project = models.ForeignKey(
        "projects.Project", verbose_name="原專案",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="asset_moved_from",
    )
    to_project = models.ForeignKey(
        "projects.Project", verbose_name="新專案",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="asset_moved_to",
    )

    operator = models.ForeignKey(
        settings.AUTH_USER_MODEL, verbose_name="操作者",
        on_delete=models.SET_NULL, null=True, related_name="asset_movements",
    )
    occurred_at = models.DateTimeField("異動時間", auto_now_add=True, db_index=True)
    note = models.CharField("備註", max_length=300, blank=True)

    class Meta:
        db_table = "assets_assetmovement"
        verbose_name = verbose_name_plural = "資產異動"
        ordering = ["-occurred_at"]
        indexes = [models.Index(fields=["asset", "-occurred_at"])]

    def __str__(self):
        return f"{self.asset.asset_no} {self.get_movement_type_display()}"
