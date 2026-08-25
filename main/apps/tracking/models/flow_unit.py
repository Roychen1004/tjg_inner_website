from decimal import Decimal

from django.conf import settings
from django.db import models
from django.utils import timezone
from simple_history.models import HistoricalRecords

from main.apps.core.models import TimeStampedModel
from main.utils.choices import FlowState


def default_task_statuses():
    """工作項目狀態選項的起手式。中間的工段（切割中、噴漆中…）由經理自己加。"""
    return ["未開始", "已完成"]


class FlowUnitQuerySet(models.QuerySet):
    def open(self):
        return self.exclude(state__in=[FlowState.DONE, FlowState.NA])

    def overdue(self):
        return self.open().filter(plan_end__lt=timezone.localdate())

    def assigned_to(self, user):
        return self.filter(assignee=user)


class FlowUnit(TimeStampedModel):
    """流程單元 —— 2026-08-14 流程制改版的核心表

    建案時勾了哪些流程工作項，每項就生成一張流程單元。
    一張單元＝一件要完成的事：有負責人、詳細內容、預計起訖日。

    與 TrackingUnit（構件批次）的分工：
      · 流程單元回答「這個案子的每件事做了沒、誰在做、何時做完」
      · 構件批次回答「階段 4 的每批貨走到哪一站」
      批次走站時自動彙總進 batch_stage_seq 有值的流程單元（4.1／4.2／4.3／4.5）。

    順序不存在這張表——順序永遠取 flow_item.seq（目錄定死，不可重排）。
    """

    project = models.ForeignKey(
        "projects.Project", verbose_name="專案",
        on_delete=models.CASCADE, related_name="flow_units",
    )
    flow_item = models.ForeignKey(
        "masters.FlowItem", verbose_name="流程工作項",
        on_delete=models.PROTECT, related_name="units",
    )

    assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL, verbose_name="負責人",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="assigned_flow_units",
        help_text="指派時對方會收到通知，在「我的任務」看到這件事",
    )
    detail = models.TextField(
        "詳細內容", blank=True,
        help_text="專案管理者寫給負責人的工作說明——要做什麼、注意什麼、交付什麼",
    )

    # ── 工作內容／產出物／完成條件（2026-08-18 D40）──────────────────
    # 生成單元時從流程目錄（flow_item）複製進來當預設值，之後每個案子
    # 可以自己改——目錄是通則，案子有例外（如這案的產出物多一份計算書）。
    # 目錄本身在 Admin 改的是「之後新案的預設」，不會回頭蓋掉已生成的單元。
    description = models.TextField("工作內容", blank=True)
    deliverables = models.TextField("產出物", blank=True)
    done_criteria = models.TextField("完成條件", blank=True)

    # ── 工作項目的狀態選項（2026-08-18 D41）─────────────────────────
    # 這張單元底下**所有工作項目共用**的狀態清單（有序），如
    # ["未開始", "切割中", "噴漆中", "已完成"]。經理在卡片上新增；
    # 頭尾以外的每一項＝一個「工段」，可以按工段把數量分配給員工做，
    # 工作項目的總進度＝各工段完成度的平均（見 FlowTask.progress_pct）。
    task_statuses = models.JSONField(
        "工作項目狀態選項", default=default_task_statuses, blank=True,
    )

    state = models.CharField(
        "狀態", max_length=10, choices=FlowState.choices, default=FlowState.TODO,
    )

    plan_start = models.DateField("預計開始", null=True, blank=True)
    plan_end = models.DateField("預計完成", null=True, blank=True, help_text="甘特圖與金流預測靠它")
    actual_start = models.DateField("實際開始", null=True, blank=True)
    actual_end = models.DateField("實際完成", null=True, blank=True)

    # ── 進度（選填）───────────────────────────────────────────────
    # 有數量的填數量（如 24 支柱），沒數量的填百分比；都不填就只看狀態。
    # 掛了批次彙總的單元（batch_stage_seq 有值且專案有批次）由系統回寫，不手填。
    qty_total = models.DecimalField("總數量", max_digits=12, decimal_places=2, null=True, blank=True)
    qty_done = models.DecimalField("已完成數量", max_digits=12, decimal_places=2, default=Decimal("0"))
    unit_of_measure = models.CharField("單位", max_length=10, blank=True)
    progress_pct = models.DecimalField("完成百分比", max_digits=5, decimal_places=2, null=True, blank=True)

    subcontractor = models.ForeignKey(
        "masters.Vendor", verbose_name="分包商／協力廠",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="flow_units",
        help_text="這件事外包給誰。錢在「金流 → 應付」逐筆掛回本單元",
    )

    note = models.CharField("備註", max_length=500, blank=True)

    history = HistoricalRecords(table_name="tracking_flowunit_history")
    objects = FlowUnitQuerySet.as_manager()

    class Meta:
        db_table = "tracking_flowunit"
        verbose_name = verbose_name_plural = "流程單元"
        ordering = ["project", "flow_item__seq"]
        constraints = [
            models.UniqueConstraint(fields=["project", "flow_item"], name="uniq_flowunit_project_item"),
            models.CheckConstraint(condition=models.Q(qty_done__gte=0), name="ck_flowunit_qty_nonneg"),
            models.CheckConstraint(
                condition=models.Q(qty_total__isnull=True) | models.Q(qty_total__gt=0),
                name="ck_flowunit_qty_total_positive",
            ),
            models.CheckConstraint(
                condition=models.Q(progress_pct__isnull=True)
                | (models.Q(progress_pct__gte=0) & models.Q(progress_pct__lte=100)),
                name="ck_flowunit_pct_range",
            ),
        ]
        indexes = [
            models.Index(fields=["project", "state"]),
            models.Index(fields=["assignee", "state"]),
            models.Index(fields=["state", "plan_end"]),
        ]

    def __str__(self):
        return f"{self.project.name}·{self.flow_item.name}"

    @classmethod
    def create_for(cls, project, flow_item):
        """生成單元的唯一入口——把目錄的內容抄進來當這個案子的預設值。

        主要負責人預設＝新增專案的人（D41）：每件事一開始都有人扛，
        經理之後在排程表逐列改派即可（改派才會發通知，這裡不發）。
        """
        return cls.objects.create(
            project=project, flow_item=flow_item,
            description=flow_item.description,
            deliverables=flow_item.deliverables,
            done_criteria=flow_item.done_criteria,
            assignee_id=project.created_by_id or project.owner_id,
        )

    # ── 進度 ───────────────────────────────────────────────────────
    @property
    def completion_ratio(self):
        """完成比例(%)。

        D44 起進度**不再手動回報**，優先序：
          已完成 → 100
          批次彙總單元 → 批次過站數（sync_batch_rollup 回寫的 qty）
          有工作項目 → 各項目總進度的平均（項目進度＝工段分配算出來的）
          其餘 → 舊資料的數量／百分比欄位，最後看狀態
        呼叫端要 prefetch_related("tasks__assignments")，不然一列一次 DB。
        """
        if self.state == FlowState.DONE:
            return 100.0
        if self.flow_item.batch_stage_seq and self.qty_total:
            return round(float(self.qty_done / self.qty_total * 100), 1)
        tasks = list(self.tasks.all())
        if tasks:
            return round(sum(t.progress_pct for t in tasks) / len(tasks), 1)
        if self.qty_total:
            return round(float(self.qty_done / self.qty_total * 100), 1)
        if self.progress_pct is not None:
            return float(self.progress_pct)
        return 0.0

    @property
    def is_overdue(self):
        return bool(
            self.plan_end
            and self.state in (FlowState.TODO, FlowState.DOING)
            and self.plan_end < timezone.localdate()
        )

    @property
    def is_batch_driven(self):
        """進度是否由構件批次自動彙總（此時不接受手動回報）。

        列表要用 viewset 的 `_has_batches` annotation（Exists 子查詢），
        不然這裡的 exists() 會一列打一次 DB。
        """
        if not self.flow_item.batch_stage_seq:
            return False
        cached = getattr(self, "_has_batches", None)
        if cached is not None:
            return bool(cached)
        return self.project.units.exists()
