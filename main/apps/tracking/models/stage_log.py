from django.conf import settings
from django.db import models

from main.apps.core.models import ImmutableLogModel
from main.utils.choices import RollbackReason, StageDirection


class TrackingUnitStageLog(ImmutableLogModel):
    """階段異動歷程（不可變）

    ⚠️ 存階段「名稱快照」而非只存 FK：日後把「品檢」改名為「品質檢驗」，
    歷史紀錄仍須顯示當時的名稱。只存 FK 會讓所有歷史跟著變——那是竄改歷史。

    回退時 reason_category 必填，這是 P3 品質失敗成本（PAF 模型）的資料來源。
    P1 就開始收集，到 P3 才有一年份的歷史可分析。
    """

    unit = models.ForeignKey(
        "tracking.TrackingUnit", verbose_name="追蹤單元",
        on_delete=models.CASCADE, related_name="stage_logs",
    )
    from_stage = models.ForeignKey(
        "masters.Stage", verbose_name="原階段",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
    )
    to_stage = models.ForeignKey(
        "masters.Stage", verbose_name="新階段", on_delete=models.PROTECT, related_name="+",
    )
    from_stage_name = models.CharField("原階段名稱", max_length=30, blank=True)
    to_stage_name = models.CharField("新階段名稱", max_length=30)

    direction = models.CharField("方向", max_length=10, choices=StageDirection.choices)
    reason_category = models.CharField(
        "原因類別", max_length=20, choices=RollbackReason.choices, blank=True,
        help_text="回退時必填。P3 品質成本統計的來源",
    )
    note = models.CharField("備註", max_length=500, blank=True)

    # 離開原階段時的完成度快照。
    # 完成度是「目前這一站做了多少」，推進時會歸零重算——
    # 沒有這個快照，「加工那一站到底做了幾支」就查不回來了。
    qty_at_exit = models.DecimalField(
        "離開時完成數量", max_digits=12, decimal_places=2, null=True, blank=True,
    )
    pct_at_exit = models.DecimalField(
        "離開時完成百分比", max_digits=5, decimal_places=2, null=True, blank=True,
    )

    moved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, verbose_name="操作者",
        on_delete=models.SET_NULL, null=True, related_name="stage_moves",
    )
    moved_at = models.DateTimeField("異動時間", auto_now_add=True, db_index=True)

    class Meta:
        db_table = "tracking_trackingunitstagelog"
        verbose_name = verbose_name_plural = "階段歷程"
        ordering = ["-moved_at"]
        indexes = [
            models.Index(fields=["unit", "-moved_at"]),
            models.Index(fields=["direction", "moved_at"]),
        ]

    def __str__(self):
        arrow = "→" if self.direction != StageDirection.BACKWARD else "←"
        return f"{self.unit.name}：{self.from_stage_name or '（建立）'} {arrow} {self.to_stage_name}"

    @property
    def is_rollback(self):
        return self.direction == StageDirection.BACKWARD

    def save(self, *args, **kwargs):
        # 寫入時把階段名稱固化
        if self.from_stage_id and not self.from_stage_name:
            self.from_stage_name = self.from_stage.name
        if self.to_stage_id and not self.to_stage_name:
            self.to_stage_name = self.to_stage.name
        super().save(*args, **kwargs)


class ProgressLog(ImmutableLogModel):
    """進度回報歷程（不可變）

    與階段歷程分開：批次可以在「加工」階段做到 60%，
    完成量的變化與階段推進是兩件獨立的事。
    """

    unit = models.ForeignKey(
        "tracking.TrackingUnit", verbose_name="追蹤單元",
        on_delete=models.CASCADE, related_name="progress_logs",
    )
    qty_before = models.DecimalField("原數量", max_digits=12, decimal_places=2, null=True, blank=True)
    qty_after = models.DecimalField("新數量", max_digits=12, decimal_places=2, null=True, blank=True)
    pct_before = models.DecimalField("原百分比", max_digits=5, decimal_places=2, null=True, blank=True)
    pct_after = models.DecimalField("新百分比", max_digits=5, decimal_places=2, null=True, blank=True)
    delta = models.DecimalField("增減量", max_digits=12, decimal_places=2)

    note = models.CharField("備註", max_length=500, blank=True, help_text="數值調降時必填")

    reported_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, verbose_name="回報者",
        on_delete=models.SET_NULL, null=True, related_name="progress_reports",
    )
    reported_at = models.DateTimeField(
        "回報時間", auto_now_add=True, db_index=True,
        help_text="系統時間，不可由使用者指定（防補登造假）",
    )

    class Meta:
        db_table = "tracking_progresslog"
        verbose_name = verbose_name_plural = "進度歷程"
        ordering = ["-reported_at"]
        indexes = [
            models.Index(fields=["unit", "-reported_at"]),
            models.Index(fields=["reported_by", "-reported_at"]),
        ]

    def __str__(self):
        sign = "+" if self.delta >= 0 else ""
        return f"{self.unit.name}：{sign}{self.delta}"
