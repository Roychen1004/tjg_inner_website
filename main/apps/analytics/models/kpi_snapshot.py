from django.db import models

from main.utils.choices import KpiStatus


class KpiSnapshot(models.Model):
    """KPI 快照

    不即時計算 —— 即時聚合會掃全表，8GB 主機撐不住，且 KPI 本來就是
    趨勢指標，不需要秒級即時。改由排程每日算好存起來，前端只讀快照。

    存分子分母的用意：使用者看到「OEE 58%」時可以點開看到
    「可用率 72% × 效能 85% × 良率 95%」，知道問題出在可用率——
    而不是只看到一個數字乾瞪眼。
    """

    kpi_code = models.CharField("KPI 代號", max_length=40, help_text="如 oee、inventory_turnover")
    period_type = models.CharField(
        "週期類型", max_length=10, help_text="daily／monthly／yearly／rolling12m",
    )
    period_start = models.DateField("統計起日")
    period_end = models.DateField("統計迄日")

    scope_type = models.CharField(
        "範圍類型", max_length=20, help_text="company／project／equipment／department／vendor",
    )
    scope_id = models.BigIntegerField("範圍 ID", null=True, blank=True, help_text="company 時為空")

    value = models.DecimalField("KPI 值", max_digits=18, decimal_places=6)
    numerator = models.DecimalField("分子", max_digits=18, decimal_places=6, null=True, blank=True)
    denominator = models.DecimalField(
        "分母", max_digits=18, decimal_places=6, null=True, blank=True,
        help_text="為 0 時狀態應為「無資料」而非「未達標」",
    )
    target_value = models.DecimalField("目標值", max_digits=18, decimal_places=6, null=True, blank=True)
    warning_value = models.DecimalField("警示門檻", max_digits=18, decimal_places=6, null=True, blank=True)

    status = models.CharField("狀態", max_length=10, choices=KpiStatus.choices)
    note = models.CharField("備註", max_length=200, blank=True)
    computed_at = models.DateTimeField("計算時間", auto_now_add=True)

    class Meta:
        db_table = "analytics_kpisnapshot"
        verbose_name = verbose_name_plural = "KPI 快照"
        ordering = ["kpi_code", "-period_start"]
        constraints = [
            # 冪等：同日重複執行 calc_daily_kpi 不會產生重複資料
            models.UniqueConstraint(
                fields=["kpi_code", "period_type", "period_start", "scope_type", "scope_id"],
                name="uniq_kpi_snapshot",
            ),
        ]
        indexes = [
            models.Index(fields=["kpi_code", "scope_type", "scope_id", "-period_start"]),
        ]

    def __str__(self):
        return f"{self.kpi_code} {self.period_start} = {self.value}"
