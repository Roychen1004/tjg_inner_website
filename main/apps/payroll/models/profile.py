"""員工的薪資設定（D57）

一人一張，掛在系統既有的員工（core.User）上——薪資名冊不另外建一份，
否則兩邊的人名遲早對不起來（誰離職了、誰改名了）。

這裡放的是「每個月都一樣、跟出勤無關」的東西：時薪、投保級距、眷屬口數。
會變的是出勤，那個記在 PayrollRecord。
"""
from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models

from main.apps.core.models import TimeStampedModel


class SalaryProfile(TimeStampedModel):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, verbose_name="員工",
        on_delete=models.CASCADE, related_name="salary_profile",
    )

    # 留空＝用法規參數的最低時薪。這樣調基本工資時只要改一個地方，
    # 沒有特別談過薪水的人就自動跟著調——而不是十幾個人一個一個改。
    hourly_wage = models.DecimalField(
        "時薪", max_digits=10, decimal_places=2, null=True, blank=True,
        validators=[MinValueValidator(Decimal("0"))],
        help_text="留空＝跟著法規參數的最低時薪走",
    )

    # 勞健保的計算基礎。不是實發薪水，是向勞保局申報的級距（見 InsuranceGrade）
    insured_salary = models.DecimalField(
        "投保薪資", max_digits=12, decimal_places=2, default=Decimal("29500"),
        validators=[MinValueValidator(Decimal("0"))],
        help_text="勞健保用的申報級距，不是實發金額",
    )
    dependents = models.PositiveSmallIntegerField(
        "健保眷屬口數", default=0,
        help_text="跟著本人一起投保的家屬人數；超過上限以上限計",
    )

    # 勞退自願提繳才會從薪水扣；雇主的 6% 是公司出的，不扣員工
    voluntary_pension_rate = models.DecimalField(
        "勞退自願提繳(%)", max_digits=5, decimal_places=2, default=Decimal("0"),
        help_text="0–6%，員工自己選擇要不要多存",
    )

    # ── 到職與離職（D57 第二輪）────────────────────────────────
    # 不滿一個月的月份，工時與保費都要按實際在職期間算。
    # 留空＝一直都在（整月），這是絕大多數人的情況
    hire_date = models.DateField(
        "到職日", null=True, blank=True,
        help_text="留空＝到職已久。到職當月的工時與保費會按實際在職日數算",
    )
    resign_date = models.DateField(
        "離職日", null=True, blank=True,
        help_text="留空＝仍在職。填了之後該月之後就不再產生薪資單",
    )

    is_active = models.BooleanField("納入薪資計算", default=True)
    note = models.TextField("備註", blank=True)

    class Meta:
        db_table = "payroll_salary_profile"
        verbose_name = verbose_name_plural = "員工薪資設定"
        ordering = ["user__employee_no", "user__username"]

    def __str__(self):
        return f"{self.user.name} 的薪資設定"

    def effective_hourly_wage(self, policy):
        """實際採用的時薪：自己填了就用自己的，沒填就用法規的最低時薪"""
        return self.hourly_wage if self.hourly_wage is not None else policy.min_hourly_wage

    def employed_range(self, first_day, last_day):
        """這個人在 [first_day, last_day] 這段期間裡實際在職的區間。

        回傳 (起, 迄)；完全沒有交集時回傳 None——那個月不該產生薪資單。
        """
        start = max(first_day, self.hire_date) if self.hire_date else first_day
        end = min(last_day, self.resign_date) if self.resign_date else last_day
        return (start, end) if start <= end else None
