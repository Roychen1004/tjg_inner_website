from decimal import Decimal

from django.db import models
from django.utils import timezone
from simple_history.models import HistoricalRecords

from main.apps.core.models import TimeStampedModel
from main.utils.choices import Status, UnitType


class TrackingUnitQuerySet(models.QuerySet):
    def batches(self):
        return self.filter(unit_type=UnitType.BATCH)

    def work_items(self):
        return self.filter(unit_type=UnitType.WORK_ITEM)

    def needs_attention(self):
        return self.exclude(status=Status.ONTRACK)


class TrackingUnit(TimeStampedModel):
    """追蹤單元 —— 進度追蹤的核心表

    同一張表承載兩種業務（決策 D01）：
      · unit_type='batch'      鋼構構件批次，進度用「完成數量／總數量」
      · unit_type='work_item'  土建工項，進度用「完成百分比」

    兩者共用階段推進、歷程、狀態等全部機制，差別只在進度表達方式。

    2026-08-13 簡化：簽收登錄、外包進出廠、運輸廠商、指派、期別、
    總重量等欄位拆掉了——進度由辦公室事後補登，這些欄位沒有人會即時填，
    填了也沒有畫面在用。真的要記，寫在備註。
    """

    code = models.CharField("編號", max_length=30, unique=True, help_text="B-YYYY-NNNN／W-YYYY-NNNN")
    project = models.ForeignKey(
        "projects.Project", verbose_name="專案", on_delete=models.CASCADE, related_name="units",
    )
    unit_type = models.CharField("類型", max_length=12, choices=UnitType.choices)
    name = models.CharField("名稱", max_length=200, help_text="如「第一期-1F鋼柱」")

    template = models.ForeignKey(
        "masters.StageTemplate", verbose_name="階段模板",
        on_delete=models.PROTECT, related_name="units",
    )
    current_stage = models.ForeignKey(
        "masters.Stage", verbose_name="目前階段",
        on_delete=models.PROTECT, related_name="current_units",
    )
    stage_entered_at = models.DateTimeField(
        "進入目前階段時間", default=timezone.now, help_text="停滯天數判定用",
    )

    status = models.CharField("狀態", max_length=10, choices=Status.choices, default=Status.ONTRACK)

    # ── 鋼構構件批次專用 ───────────────────────────────────────────
    qty_total = models.DecimalField("總數量", max_digits=12, decimal_places=2, null=True, blank=True)
    qty_done = models.DecimalField("已完成數量", max_digits=12, decimal_places=2, default=Decimal("0"))
    unit_of_measure = models.CharField("單位", max_length=10, blank=True, help_text="支／組／噸／片／件")

    # ── 土建工項專用 ───────────────────────────────────────────────
    progress_pct = models.DecimalField(
        "完成百分比", max_digits=5, decimal_places=2, null=True, blank=True,
    )
    subcontractor = models.ForeignKey(
        "masters.Vendor", verbose_name="分包商",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="subcontracted_units",
        help_text="做這個工項的是誰。分包的錢在「金流 → 應付」管理，不在這裡",
    )

    # ── 日期 ───────────────────────────────────────────────────────
    plan_start = models.DateField("預計開始", null=True, blank=True)
    plan_end = models.DateField("預計完成", null=True, blank=True)
    actual_start = models.DateField("實際開始", null=True, blank=True)
    actual_end = models.DateField("實際完成", null=True, blank=True)

    note = models.CharField("備註", max_length=500, blank=True)

    history = HistoricalRecords(table_name="tracking_trackingunit_history")
    objects = TrackingUnitQuerySet.as_manager()

    class Meta:
        db_table = "tracking_trackingunit"
        verbose_name = verbose_name_plural = "追蹤單元"
        ordering = ["project", "current_stage__seq", "name"]
        indexes = [
            models.Index(fields=["project", "unit_type"]),
            models.Index(fields=["current_stage"]),
            models.Index(fields=["status"]),
            models.Index(fields=["stage_entered_at"]),
        ]
        constraints = [
            models.CheckConstraint(
                condition=~models.Q(unit_type=UnitType.BATCH)
                | (models.Q(qty_total__isnull=False) & ~models.Q(unit_of_measure="")),
                name="ck_unit_batch_requires_qty",
            ),
            models.CheckConstraint(
                condition=~models.Q(unit_type=UnitType.WORK_ITEM) | models.Q(progress_pct__isnull=False),
                name="ck_unit_workitem_requires_pct",
            ),
            models.CheckConstraint(condition=models.Q(qty_done__gte=0), name="ck_unit_qty_done_nonneg"),
            models.CheckConstraint(
                condition=models.Q(qty_total__isnull=True) | models.Q(qty_done__lte=models.F("qty_total")),
                name="ck_unit_qty_done_lte_total",
            ),
            models.CheckConstraint(
                condition=models.Q(qty_total__isnull=True) | models.Q(qty_total__gt=0),
                name="ck_unit_qty_total_positive",
            ),
            models.CheckConstraint(
                condition=models.Q(progress_pct__isnull=True)
                | (models.Q(progress_pct__gte=0) & models.Q(progress_pct__lte=100)),
                name="ck_unit_pct_range",
            ),
        ]

    def __str__(self):
        return f"{self.project.name}·{self.name}"

    # ── 進度（統一介面）────────────────────────────────────────────
    @property
    def completion_ratio(self):
        """**目前這一站**的完成比例(%)。

        ⚠️ 不是整批從頭到尾的累計。24 支鋼柱在「加工」做完 24 支是 100%，
        推進到下一站後歸零重算。整體進度看的是階段（第 2/5 站），不是這個數字。

        構件批次算數量、土建工項用百分比——前端只要一個進度條元件，
        不必寫 if unit_type == 'batch'。
        """
        if self.unit_type == UnitType.WORK_ITEM:
            return float(self.progress_pct or 0)
        if not self.qty_total:
            return 0.0
        return round(float(self.qty_done / self.qty_total * 100), 1)

    @property
    def is_complete(self):
        return self.completion_ratio >= 100

    # ── 階段 ───────────────────────────────────────────────────────
    @property
    def days_in_stage(self):
        return (timezone.now() - self.stage_entered_at).days

    @property
    def is_stalled(self):
        threshold = self.current_stage.stall_days
        return bool(threshold and self.days_in_stage > threshold)

    @property
    def active_stages(self):
        """這條流程啟用中的所有站，依順序。

        ⚠️ 用 `.all()` 再在 Python 過濾，不是 `.filter(is_active=True)`——
        後者每次都會打一次 DB，即使外面已經 `prefetch_related("template__stages")`。
        看板一次列 300 張卡，差別是 1 次查詢 vs 900 次。
        """
        return sorted((s for s in self.template.stages.all() if s.is_active), key=lambda s: s.seq)

    @property
    def stage_total(self):
        return len(self.active_stages)

    @property
    def can_advance(self):
        stages = self.active_stages
        return bool(stages) and self.current_stage.seq < stages[-1].seq

    @property
    def can_rollback(self):
        stages = self.active_stages
        return bool(stages) and self.current_stage.seq > stages[0].seq

    # ── 編號 ───────────────────────────────────────────────────────
    @classmethod
    def generate_code(cls, unit_type):
        prefix_char = "B" if unit_type == UnitType.BATCH else "W"
        year = timezone.localdate().year
        prefix = f"{prefix_char}-{year}-"
        last = cls.objects.filter(code__startswith=prefix).order_by("-code").first()
        seq = int(last.code.rsplit("-", 1)[1]) + 1 if last else 1
        return f"{prefix}{seq:04d}"

    def save(self, *args, **kwargs):
        if not self.code:
            self.code = self.generate_code(self.unit_type)
        if not self.current_stage_id and self.template_id:
            self.current_stage = self.template.first_stage()
        super().save(*args, **kwargs)
