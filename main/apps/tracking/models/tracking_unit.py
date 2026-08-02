from decimal import Decimal

from django.conf import settings
from django.db import models
from django.utils import timezone
from simple_history.models import HistoricalRecords

from main.apps.core.models import TimeStampedModel
from main.utils.choices import Status, UnitType, WorkMode


class TrackingUnitQuerySet(models.QuerySet):
    def batches(self):
        return self.filter(unit_type=UnitType.BATCH)

    def work_items(self):
        return self.filter(unit_type=UnitType.WORK_ITEM)

    def needs_attention(self):
        return self.exclude(status=Status.ONTRACK)

    def awaiting_signoff(self):
        """在需簽收的階段但尚未簽收 —— 這些就是「請款卡住」的批次"""
        return self.filter(
            current_stage__requires_signoff=True, signoff_date__isnull=True,
        )

    def outsource_overdue(self, as_of=None):
        as_of = as_of or timezone.localdate()
        return self.filter(
            work_mode=WorkMode.OUTSOURCE,
            outsource_due_date__lt=as_of,
            outsource_out_date__isnull=True,
        )

    def assigned_to(self, user):
        return self.filter(assignee=user)


class TrackingUnit(TimeStampedModel):
    """追蹤單元 —— 全系統的核心表

    同一張表承載兩種業務（決策 D01）：
      · unit_type='batch'      鋼構構件批次，走 9 階段，進度用「完成數量／總數量」
      · unit_type='work_item'  土建工項，走 5 階段，進度用「完成百分比」

    兩者共用階段推進、歷程、狀態、指派、簽收等全部機制，
    差別只在進度表達方式與少數專屬欄位。
    """

    code = models.CharField("編號", max_length=30, unique=True, help_text="B-YYYY-NNNN／W-YYYY-NNNN")
    project = models.ForeignKey(
        "projects.Project", verbose_name="專案", on_delete=models.CASCADE, related_name="units",
    )
    phase = models.ForeignKey(
        "projects.ProjectPhase", verbose_name="期別",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="units",
        help_text="決定簽收時觸發哪一筆請款里程碑",
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

    assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL, verbose_name="指派給",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="assigned_units",
        help_text="「我的工作」畫面的依據",
    )
    status = models.CharField("狀態", max_length=10, choices=Status.choices, default=Status.ONTRACK)

    # ── 鋼構構件批次專用 ───────────────────────────────────────────
    qty_total = models.DecimalField("總數量", max_digits=12, decimal_places=2, null=True, blank=True)
    qty_done = models.DecimalField("已完成數量", max_digits=12, decimal_places=2, default=Decimal("0"))
    unit_of_measure = models.CharField("單位", max_length=10, blank=True, help_text="支／組／噸／片／件")

    total_weight_kg = models.DecimalField(
        "總重量(kg)", max_digits=12, decimal_places=2, null=True, blank=True,
        help_text="鋼構論噸計價。也是「累計達 X%」與「分批按量請款」的計算基準。"
                  "編輯權限限廠長／專案負責人／經營者",
    )

    # ── 土建工項專用 ───────────────────────────────────────────────
    progress_pct = models.DecimalField(
        "完成百分比", max_digits=5, decimal_places=2, null=True, blank=True,
    )
    subcontractor = models.ForeignKey(
        "masters.Vendor", verbose_name="分包商",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="subcontracted_units",
    )
    subcontract_amount = models.DecimalField(
        "分包契約金額", max_digits=14, decimal_places=2, null=True, blank=True,
    )

    # ── 外包（表面處理等）─────────────────────────────────────────
    work_mode = models.CharField(
        "作業方式", max_length=12, choices=WorkMode.choices, default=WorkMode.SELF,
    )
    outsource_vendor = models.ForeignKey(
        "masters.Vendor", verbose_name="協力廠",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="outsourced_units",
    )
    outsource_in_date = models.DateField("實際進廠日", null=True, blank=True)
    outsource_due_date = models.DateField("預計出廠日", null=True, blank=True)
    outsource_out_date = models.DateField("實際出廠日", null=True, blank=True)

    transport_vendor = models.ForeignKey(
        "masters.Vendor", verbose_name="運輸廠商",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="transported_units",
    )

    # ── 進場簽收（決策 D12／D13）───────────────────────────────────
    signoff_date = models.DateField(
        "簽收日", null=True, blank=True, db_index=True,
        help_text="業主／監造簽收日。登錄後才觸發請款評估",
    )
    signoff_by_name = models.CharField(
        "簽收人", max_length=50, blank=True, help_text="業主方人員姓名（非系統使用者）",
    )
    signoff_doc_no = models.CharField("簽收單號", max_length=40, blank=True)
    signoff_location = models.ForeignKey(
        "inventory.Location", verbose_name="簽收地點",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="signed_units",
        help_text="與里程碑的指定交貨地點比對，不符時警告但不阻擋",
    )

    # ── 日期 ───────────────────────────────────────────────────────
    plan_start = models.DateField("預計開始", null=True, blank=True)
    plan_end = models.DateField("預計完成", null=True, blank=True)
    actual_start = models.DateField("實際開始", null=True, blank=True)
    actual_end = models.DateField("實際完成", null=True, blank=True)

    rollback_count = models.SmallIntegerField(
        "回退次數", default=0, help_text="≥2 次自動升級為延誤",
    )
    note = models.CharField("備註", max_length=500, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, verbose_name="建立者",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="created_units",
    )

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
            models.Index(fields=["assignee", "status"]),
            models.Index(fields=["stage_entered_at"]),
            models.Index(fields=["project", "phase"]),
            # 外包逾期掃描只掃還沒回廠的幾十筆，不掃全表
            models.Index(
                fields=["work_mode", "outsource_due_date"],
                condition=models.Q(outsource_out_date__isnull=True),
                name="idx_unit_outsource_pending",
            ),
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
            models.CheckConstraint(
                condition=models.Q(outsource_out_date__isnull=True)
                | models.Q(outsource_in_date__isnull=True)
                | models.Q(outsource_out_date__gte=models.F("outsource_in_date")),
                name="ck_unit_outsource_dates",
            ),
        ]

    def __str__(self):
        return f"{self.project.name}·{self.name}"

    # ── 進度（統一介面）────────────────────────────────────────────
    @property
    def completion_ratio(self):
        """**目前這一站**的完成比例(%)。

        ⚠️ 不是整批從頭到尾的累計。24 支鋼柱在「加工」做完 24 支是 100%，
        推進到「品檢」後歸零重算——因為要重新檢 24 支。
        整體進度看的是階段（第 3/9 站），不是這個數字。

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

    # ── 簽收 ───────────────────────────────────────────────────────
    @property
    def is_signed_off(self):
        return self.signoff_date is not None

    @property
    def is_awaiting_signoff(self):
        """在需簽收的階段但還沒簽 —— 請款卡在這裡"""
        return self.current_stage.requires_signoff and not self.is_signed_off

    @property
    def is_outsource_overdue(self):
        return bool(
            self.work_mode == WorkMode.OUTSOURCE
            and self.outsource_due_date
            and not self.outsource_out_date
            and self.outsource_due_date < timezone.localdate()
        )

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
