"""行政事項（D53）——公司非案子的例行／臨時事務

兩張表：
  AffairRule  例行規則（每週／每月／每年）——只描述「怎麼重複」
  AffairTask  一筆待辦（日曆上的一格）——臨時事項直接建這張；
              例行事項由 schedule_service 依規則自動長出來，每筆個別打勾

規則與待辦分開的原因：完成狀態、逾期追蹤、單次的指派微調都發生在
「某一次」上；改了規則不影響已完成的歷史。
"""
from decimal import Decimal

from django.conf import settings
from django.db import models
from django.utils import timezone

from main.apps.core.models import TimeStampedModel
from main.utils.choices import AffairFreq, MoneyDirection


class AffairRule(TimeStampedModel):
    title = models.CharField("標題", max_length=100)
    category = models.ForeignKey(
        "affairs.AffairCategory", verbose_name="類別",
        on_delete=models.PROTECT, related_name="rules",
    )
    note = models.TextField("備註", blank=True)

    # ── 金錢（D55）─────────────────────────────────────────────────
    # 行政事項也會花錢（網路費、清潔費）。填了金額就會進「金流 → 收支明細」
    # 與現金流預測；0＝純待辦，不碰錢
    amount = models.DecimalField(
        "金額", max_digits=14, decimal_places=2, default=Decimal("0"),
        help_text="每一次要收或要付多少（稅後）。0＝不涉及金錢，不進金流",
    )
    direction = models.CharField(
        "收支", max_length=3, choices=MoneyDirection.choices, default=MoneyDirection.OUT,
    )
    # D56：只是「參考」的金額——預估會花多少、對方大概報多少。
    # 記在事項上給人看得到，但**不進金流**（收支明細與現金流預測都不算）：
    # 還沒談定的估算混進帳本，累計那條線就不是錢了
    is_reference = models.BooleanField(
        "只是參考", default=False,
        help_text="打勾＝預估金額，只顯示不計入公司的收入與支出",
    )

    freq = models.CharField("頻率", max_length=10, choices=AffairFreq.choices)
    weekdays = models.JSONField(
        "星期幾", default=list, blank=True, help_text="每週用：0=週一 … 6=週日，可多選",
    )
    month_day = models.PositiveSmallIntegerField(
        "每月幾日", null=True, blank=True, help_text="每月用：1–31，超過當月天數以月底計",
    )
    year_month = models.PositiveSmallIntegerField("每年幾月", null=True, blank=True)
    year_day = models.PositiveSmallIntegerField("每年幾日", null=True, blank=True)
    start_date = models.DateField("起始日")
    end_date = models.DateField("結束日", null=True, blank=True)

    assignees = models.ManyToManyField(
        settings.AUTH_USER_MODEL, verbose_name="指派給",
        blank=True, related_name="affair_rules",
    )
    is_active = models.BooleanField("啟用中", default=True)
    # 已長出待辦到哪一天——經理手動刪掉的某一次，不會在下次瀏覽時又長回來
    materialized_until = models.DateField("已展開至", null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, verbose_name="建立者",
        null=True, blank=True, on_delete=models.SET_NULL, related_name="+",
    )

    class Meta:
        db_table = "affairs_rule"
        verbose_name = verbose_name_plural = "行政例行規則"
        ordering = ["id"]

    def __str__(self):
        return f"{self.title}（{self.freq_text}）"

    WEEKDAY_NAMES = "一二三四五六日"

    @property
    def freq_text(self):
        """人話版的重複規則，如「每週一、四」「每月 5 日」"""
        if self.freq == AffairFreq.WEEKLY:
            days = "、".join(
                self.WEEKDAY_NAMES[d] for d in sorted(self.weekdays or []) if 0 <= d <= 6
            )
            return f"每週{days}"
        if self.freq == AffairFreq.MONTHLY:
            return f"每月 {self.month_day} 日"
        return f"每年 {self.year_month} 月 {self.year_day} 日"


class AffairTask(TimeStampedModel):
    rule = models.ForeignKey(
        AffairRule, verbose_name="例行規則",
        null=True, blank=True, on_delete=models.SET_NULL, related_name="tasks",
    )
    title = models.CharField("標題", max_length=100)
    category = models.ForeignKey(
        "affairs.AffairCategory", verbose_name="類別",
        on_delete=models.PROTECT, related_name="tasks",
    )
    date = models.DateField("日期", db_index=True)
    note = models.TextField("備註", blank=True)

    # ── 金錢（D55）──────────────────────────────────────────────────
    # 例行事項由規則帶入，之後可個別改（這個月的電費比較高）
    amount = models.DecimalField(
        "金額", max_digits=14, decimal_places=2, default=Decimal("0"),
        help_text="這一次要收或要付多少（稅後）。0＝不涉及金錢，不進金流",
    )
    direction = models.CharField(
        "收支", max_length=3, choices=MoneyDirection.choices, default=MoneyDirection.OUT,
    )
    # D56：預估的金額，只給人看，不進金流（例行規則帶入，之後可個別改：
    # 這個月的估價談定了，就把「參考」拿掉變成真的支出）
    is_reference = models.BooleanField(
        "只是參考", default=False,
        help_text="打勾＝預估金額，只顯示不計入公司的收入與支出",
    )

    assignees = models.ManyToManyField(
        settings.AUTH_USER_MODEL, verbose_name="指派給",
        blank=True, related_name="affair_tasks",
    )

    # 完成＝整件事一個勾（多人指派時任一人勾即完成，老闆定的）
    is_done = models.BooleanField("已完成", default=False)
    done_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, verbose_name="完成者",
        null=True, blank=True, on_delete=models.SET_NULL, related_name="+",
    )
    done_at = models.DateTimeField("完成時間", null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, verbose_name="建立者",
        null=True, blank=True, on_delete=models.SET_NULL, related_name="+",
    )

    class Meta:
        db_table = "affairs_task"
        verbose_name = verbose_name_plural = "行政事項"
        ordering = ["date", "id"]
        constraints = [
            # 同一條規則同一天只長一次——併發瀏覽時靠這條擋重複
            models.UniqueConstraint(
                fields=["rule", "date"],
                condition=models.Q(rule__isnull=False),
                name="uniq_affair_rule_date",
            ),
        ]

    def __str__(self):
        return f"{self.date} {self.title}"

    @property
    def is_overdue(self):
        return not self.is_done and self.date < timezone.localdate()

    @property
    def has_money(self):
        """真的會進金流的錢。參考金額不算——它只是估算（D56）"""
        return self.amount is not None and self.amount > 0 and not self.is_reference
