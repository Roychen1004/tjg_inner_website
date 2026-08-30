from decimal import Decimal

from django.conf import settings
from django.db import models

from main.apps.core.models import ImmutableLogModel, TimeStampedModel

# 狀態選項的頭尾——不是工段，不能分配工作、不算進度分母
TERMINAL_STATUSES = ("未開始", "已完成")


class FlowTask(TimeStampedModel):
    """流程單元底下的工作項目（2026-08-17 老闆需求）

    一張流程單元往往不只一件事——「採購」可能同時要買鐵材 500 噸、
    螺栓 2000 支。一列＝一個內容物：名稱、數量、單位，以及自己的狀態。

    狀態（2026-08-18 D41）：選項清單存在單元的 `task_statuses`（經理維護，
    同單元所有項目共用），如「未開始→切割中→噴漆中→已完成」。
    頭尾以外的每一項＝一個**工段**，可以按工段把數量分配給員工
    （FlowTaskAssignment），總進度＝各工段完成度的平均。
    欄位本身仍是自由文字——換單元換語彙，資料庫不設列舉。
    """

    unit = models.ForeignKey(
        "tracking.FlowUnit", verbose_name="流程單元",
        on_delete=models.CASCADE, related_name="tasks",
    )
    name = models.CharField("內容物", max_length=100, help_text="要採購／製作的東西，如「鐵材」")
    qty = models.DecimalField("數量", max_digits=12, decimal_places=2, null=True, blank=True)
    unit_of_measure = models.CharField("單位", max_length=10, blank=True)
    status = models.CharField("狀態", max_length=20, default="未開始")
    # D45：狀態清單改成**每個項目自己的**（鐵材走 切割中→噴漆中、
    # 螺栓走 已下訂單→已到貨——不同內容物的工序本來就不同）。
    # 清單從空開始、由使用者自己加（可沿用之前用過的字）；
    # 每一項＝一個可分配的工段，「未開始／已完成」是隱含的頭尾，不用加。
    statuses = models.JSONField("狀態清單（工段）", default=list, blank=True)

    class Meta:
        db_table = "tracking_flowtask"
        verbose_name = verbose_name_plural = "工作項目"
        ordering = ["id"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(qty__isnull=True) | models.Q(qty__gt=0),
                name="ck_flowtask_qty_positive",
            ),
        ]

    def __str__(self):
        return f"{self.unit}·{self.name}"

    @property
    def work_statuses(self):
        """這張項目要經過的工段（自己的狀態清單；保險起見仍濾掉頭尾字）。"""
        return [s for s in self.statuses if s not in TERMINAL_STATUSES]

    @property
    def progress_pct(self):
        """總進度(%)＝各工段完成度的平均（老闆定的算法：兩個工段各占 50%…）。

        工段完成度＝該工段所有分配的已完成量 ÷ 項目數量
        （項目沒填數量就用該工段的已分配量當分母）。
        沒有工段時退回看狀態：已完成＝100、其餘 0。
        要先 prefetch_related("assignments")，不然一列項目打一次 DB。
        """
        stages = self.work_statuses
        if not stages:
            return 100.0 if self.status == "已完成" else 0.0
        done = {s: Decimal("0") for s in stages}
        assigned = {s: Decimal("0") for s in stages}
        for a in self.assignments.all():
            if a.status in done:
                done[a.status] += a.qty_done
                assigned[a.status] += a.qty_assigned
        total = 0.0
        for s in stages:
            denom = self.qty or assigned[s]
            if denom:
                total += min(float(done[s] / denom), 1.0)
        return round(total / len(stages) * 100, 1)


class FlowTaskAssignment(TimeStampedModel):
    """工作分配（2026-08-18 D41）——把一個工作項目的某個工段分量派給一個員工

    例：鐵材 200 噸、工段「切割中」→ 分 50 噸給工廠員工1。
    對方收到通知、在「我的任務」看到並回報完成量；
    回報完成時通知單元的主要負責人（附該工段的彙總進度）。
    """

    task = models.ForeignKey(
        FlowTask, verbose_name="工作項目",
        on_delete=models.CASCADE, related_name="assignments",
    )
    status = models.CharField(
        "工段", max_length=20,
        help_text="對應單元狀態選項裡的一項（頭尾「未開始／已完成」除外），如「切割中」",
    )
    assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL, verbose_name="負責員工",
        on_delete=models.SET_NULL, null=True, related_name="task_assignments",
    )
    qty_assigned = models.DecimalField("分配數量", max_digits=12, decimal_places=2)
    qty_done = models.DecimalField("已完成數量", max_digits=12, decimal_places=2, default=Decimal("0"))
    note = models.CharField(
        "注意事項", max_length=500, blank=True,
        help_text="經理分配時的叮嚀（D49）——被分到的人在「我的任務」會特別看到這段話",
    )

    # ── 產能（D52）────────────────────────────────────────────────
    work_type = models.ForeignKey(
        "masters.WorkType", verbose_name="工作類型",
        on_delete=models.PROTECT, null=True, blank=True, related_name="assignments",
        help_text="產能統計的分類。新分配必選；D52 之前的舊資料為空＝未分類",
    )
    started_at = models.DateField(
        "實際開始日", null=True, blank=True,
        help_text="員工在「我的任務」按「開始」的那天；回報過就自動視為已開始",
    )
    completed_at = models.DateField(
        "完成日", null=True, blank=True, help_text="完成量報滿分配量的那天，系統自動記",
    )
    man_days_override = models.DecimalField(
        "工數（補登修正）", max_digits=6, decimal_places=2, null=True, blank=True,
        help_text="空＝系統依回報自動計（一人一天＝1 工，記在當天有回報的分配上、"
                  "多件均分）；經理覺得不準可在此直接填總工數蓋過",
    )

    class Meta:
        db_table = "tracking_flowtaskassignment"
        verbose_name = verbose_name_plural = "工作分配"
        ordering = ["id"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(qty_assigned__gt=0), name="ck_taskassign_qty_positive",
            ),
            models.CheckConstraint(
                condition=models.Q(qty_done__gte=0)
                & models.Q(qty_done__lte=models.F("qty_assigned")),
                name="ck_taskassign_done_range",
            ),
        ]
        indexes = [
            models.Index(fields=["assignee"]),
        ]

    def __str__(self):
        return f"{self.task}·{self.status}·{self.assignee_id}"

    @property
    def is_done(self):
        return self.qty_done >= self.qty_assigned


class AssignmentReport(ImmutableLogModel):
    """回報紀錄（D52）——工作分配的每日完成量流水帳，寫入後不可改

    產能統計的原始資料：一列＝某人某天在某份分配上回報了多少量。
    計工規則（老闆 2026-08-30 定）：一人一天＝1 工，
    記在**當天有回報的分配**上；同日多件有回報就均分；沒回報的天不計。
    """

    assignment = models.ForeignKey(
        FlowTaskAssignment, verbose_name="工作分配",
        on_delete=models.CASCADE, related_name="reports",
    )
    date = models.DateField("回報日", help_text="預設當天；補登時可回填")
    qty_delta = models.DecimalField(
        "本次回報量", max_digits=12, decimal_places=2,
        help_text="這次回報「新增」的完成量（更正時可為負）",
    )
    reported_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, verbose_name="回報者",
        on_delete=models.SET_NULL, null=True, related_name="assignment_reports",
    )
    created_at = models.DateTimeField("寫入時間", auto_now_add=True)

    class Meta:
        db_table = "tracking_assignmentreport"
        verbose_name = verbose_name_plural = "回報紀錄"
        ordering = ["date", "id"]
        indexes = [
            models.Index(fields=["assignment", "date"]),
            models.Index(fields=["date"]),
        ]

    def __str__(self):
        return f"{self.assignment_id}·{self.date}·{self.qty_delta:+g}"
