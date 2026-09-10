"""薪資法規參數（D57）

⚠️ 這裡沒有一個數字是寫死在程式裡的。

理由：基本工資每年調、勞健保費率隔幾年動一次、加班倍率的算法連勞動部
自己都有「1.33 還是 1.34」的爭議。把這些烤進程式，等於每次修法都要
改程式、重建映像、重新部署——而那件事會拖到會計師算不出這個月的薪水。

所以全部做成可編輯欄位，預設值填現行法規（115 年／2026）。
會計師在畫面上改完存檔，下一次試算就是新的數字。

⚠️ 改了參數不會回頭改動已確認的薪資期間——每個期間在確認時會把當下
用的整組參數快照存進 PayrollPeriod.policy_snapshot（鐵律 5：錢的歷程
不可竄改）。
"""
from decimal import Decimal

from django.core.validators import MinValueValidator
from django.db import models

from main.apps.core.models import TimeStampedModel


class PayrollPolicy(TimeStampedModel):
    """全公司共用的一組薪資參數。只會有一筆（get_active 取用）。

    每個欄位後面括號裡是法源，改動前請先確認法規真的變了。
    """

    name = models.CharField("名稱", max_length=50, default="現行法規")
    effective_from = models.DateField(
        "適用起日", null=True, blank=True,
        help_text="僅供辨識，例如 2026-01-01 基本工資調整生效日",
    )

    # ── 工資（勞動部公告的最低工資）────────────────────────────────
    min_hourly_wage = models.DecimalField(
        "最低時薪", max_digits=10, decimal_places=2, default=Decimal("196"),
        validators=[MinValueValidator(Decimal("0"))],
        help_text="115 年（2026）起為 196 元／小時",
    )
    normal_hours_per_day = models.DecimalField(
        "每日正常工時", max_digits=4, decimal_places=2, default=Decimal("8"),
        help_text="勞基法 §30：每日不得超過 8 小時",
    )
    # 8:00–17:30 扣掉 1 小時休息＝8.5 小時，其中 8 小時是正常工時，
    # 多出來的 0.5 小時每天都會發生——所以做成預設值自動帶出來，
    # 而不是要會計師每個月自己乘一次
    default_daily_ot_hours = models.DecimalField(
        "每日固定加班時數", max_digits=4, decimal_places=2, default=Decimal("0.5"),
        help_text="產生薪資單時自動帶入的每日加班時數，之後可逐人調整",
    )

    # ── 加班倍率（勞基法 §24）──────────────────────────────────────
    # 法條寫「加給三分之一以上」，1+1/3＝1.3333…；勞動部建議用 1.34
    # 而不是 1.33，因為四捨五入後 1.33 會低於法定下限——少給就是違法。
    # 預設填 1.34／1.67，要用 4/3、5/3 的話自己改成 1.3333／1.6667。
    ot_weekday_1_rate = models.DecimalField(
        "平日加班前段倍率", max_digits=5, decimal_places=4, default=Decimal("1.34"),
        help_text="§24：延長工時 2 小時內，加給 1/3 以上",
    )
    ot_weekday_1_hours = models.DecimalField(
        "平日加班前段時數", max_digits=4, decimal_places=2, default=Decimal("2"),
    )
    ot_weekday_2_rate = models.DecimalField(
        "平日加班後段倍率", max_digits=5, decimal_places=4, default=Decimal("1.67"),
        help_text="§24：再延長 2 小時內，加給 2/3 以上",
    )

    # 休息日（一例一休的「休」）出勤：前 2 小時、第 3–8 小時、超過 8 小時三段
    ot_restday_1_rate = models.DecimalField(
        "休息日前 2 小時倍率", max_digits=5, decimal_places=4, default=Decimal("1.34"),
    )
    ot_restday_1_hours = models.DecimalField(
        "休息日前段時數", max_digits=4, decimal_places=2, default=Decimal("2"),
    )
    ot_restday_2_rate = models.DecimalField(
        "休息日第 3–8 小時倍率", max_digits=5, decimal_places=4, default=Decimal("1.67"),
    )
    ot_restday_2_hours = models.DecimalField(
        "休息日中段時數", max_digits=4, decimal_places=2, default=Decimal("6"),
    )
    ot_restday_3_rate = models.DecimalField(
        "休息日超過 8 小時倍率", max_digits=5, decimal_places=4, default=Decimal("2.67"),
    )
    holiday_rate = models.DecimalField(
        "國定假日出勤倍率", max_digits=5, decimal_places=4, default=Decimal("2"),
        help_text="§39 加倍發給：出勤即再給一日工資（做 1 給 8）",
    )

    # ── 勞工保險（含就業保險）──────────────────────────────────────
    labor_insurance_rate = models.DecimalField(
        "勞保費率(%)", max_digits=6, decimal_places=3, default=Decimal("12.5"),
        help_text="普通事故 11.5% ＋ 就業保險 1%",
    )
    labor_insurance_employee_share = models.DecimalField(
        "勞保勞工負擔(%)", max_digits=6, decimal_places=3, default=Decimal("20"),
        help_text="勞工 20%／雇主 70%／政府 10%",
    )
    labor_insurance_employer_share = models.DecimalField(
        "勞保雇主負擔(%)", max_digits=6, decimal_places=3, default=Decimal("70"),
        help_text="公司出的部分。不從薪水扣，但要算進人事成本",
    )

    # ── 全民健康保險 ───────────────────────────────────────────────
    health_insurance_rate = models.DecimalField(
        "健保費率(%)", max_digits=6, decimal_places=3, default=Decimal("5.17"),
    )
    health_insurance_employee_share = models.DecimalField(
        "健保本人負擔(%)", max_digits=6, decimal_places=3, default=Decimal("30"),
        help_text="被保險人 30%／投保單位 60%／政府 10%",
    )
    health_max_dependents = models.PositiveSmallIntegerField(
        "健保眷屬計費上限", default=3, help_text="眷屬超過 3 口者以 3 口計",
    )
    health_insurance_employer_share = models.DecimalField(
        "健保投保單位負擔(%)", max_digits=6, decimal_places=3, default=Decimal("60"),
        help_text="被保險人 30%／投保單位 60%／政府 10%",
    )
    # ⚠️ 雇主負擔健保費**不看員工實際有幾個眷屬**——一律用全國平均眷口數。
    # 所以員工加保三個眷屬，多出來的錢是員工自己付，公司負擔不變。
    # 平均眷口數 2024 年起由 0.57 調為 0.56，故計費人數＝1 + 0.56 = 1.56
    health_employer_head_factor = models.DecimalField(
        "健保雇主計費人數", max_digits=5, decimal_places=2, default=Decimal("1.56"),
        help_text="本人 1 ＋ 全國平均眷口數 0.56（2024 起）。與員工實際眷屬數無關",
    )

    # ── 勞工退休金 ─────────────────────────────────────────────────
    # 雇主提繳 6% 是雇主的成本，**不從薪水扣**；這裡留著是為了讓薪資單
    # 能一併呈現「公司為你提繳多少」，以及算公司的人事總成本。
    pension_employer_rate = models.DecimalField(
        "勞退雇主提繳(%)", max_digits=6, decimal_places=3, default=Decimal("6"),
    )

    # ── 公司自訂（非法規）──────────────────────────────────────────
    welfare_fund_rate = models.DecimalField(
        "員工福利金(%)", max_digits=6, decimal_places=3, default=Decimal("1"),
        help_text="公司規定，按應發總額（未扣除前）計算",
    )

    # ── 提醒用的法定上限（超過只警示，不擋）────────────────────────
    daily_ot_hours_cap = models.DecimalField(
        "每日加班上限", max_digits=4, decimal_places=2, default=Decimal("4"),
        help_text="§32：延長工時連同正常工時，一日不得超過 12 小時",
    )
    monthly_ot_hours_cap = models.DecimalField(
        "每月加班上限", max_digits=6, decimal_places=2, default=Decimal("46"),
        help_text="§32：延長工時一個月不得超過 46 小時",
    )

    class Meta:
        db_table = "payroll_policy"
        verbose_name = verbose_name_plural = "薪資法規參數"

    def __str__(self):
        return f"{self.name}（時薪 {self.min_hourly_wage}）"

    @classmethod
    def get_active(cls):
        """取用中的那一組。沒有就用預設值建一筆——空資料庫也要能算。"""
        policy = cls.objects.order_by("id").first()
        if policy is None:
            policy = cls.objects.create()
        return policy

    def snapshot(self):
        """存進薪資期間的參數快照。之後改參數不會動到已算好的月份。"""
        return {
            field.name: str(getattr(self, field.name))
            for field in self._meta.fields
            if field.name not in ("id", "created_at", "updated_at")
        }


class InsuranceGrade(TimeStampedModel):
    """投保薪資分級表（勞保 11 級，115 年）。

    勞健保**不是**用當月實發金額算的，是用事先向勞保局申報的「投保薪資」，
    而申報值只能是這張表上的數字。所以這裡是一張可維護的主檔，不是
    程式裡的常數——級距每年跟著基本工資調。
    """

    level = models.PositiveSmallIntegerField("級數", unique=True)
    amount = models.DecimalField("月投保薪資", max_digits=12, decimal_places=2)
    is_active = models.BooleanField("啟用中", default=True)

    class Meta:
        db_table = "payroll_insurance_grade"
        verbose_name = verbose_name_plural = "投保薪資分級"
        ordering = ["level"]

    def __str__(self):
        return f"第 {self.level} 級　{self.amount:,.0f}"


class Holiday(TimeStampedModel):
    """國定假日（含補假）。

    只用來算「該月應上班天數」的預設值——會計師仍然可以在薪資期間上
    直接改那個數字（有人排班本來就不是週一到週五）。

    只需要登記**落在週一至週五**的假日：週末本來就不是上班日，
    重複登記不會改變任何結果（登記了也無妨，日曆上會標出來給人看）。

    另一種用途是**補班日**（`is_workday=True`）：本來是週末但政府公告要上班。
    """

    date = models.DateField("日期", unique=True)
    name = models.CharField("名稱", max_length=50)
    # 補班日：本來是週末，但政府公告要上班。2026 年已取消補班制度，
    # 但這個欄位要留著——制度改回來的時候不必再動程式
    is_workday = models.BooleanField(
        "這天要上班", default=False,
        help_text="補班日打勾：本來是週末但要上班，會算進應上班天數",
    )

    class Meta:
        db_table = "payroll_holiday"
        verbose_name = verbose_name_plural = "國定假日"
        ordering = ["date"]

    def __str__(self):
        return f"{self.date} {self.name}"
