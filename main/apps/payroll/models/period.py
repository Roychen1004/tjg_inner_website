"""薪資期間與薪資單（D57）

三張表：
  PayrollPeriod  一個月一張——這個月的共同前提（應上班天數、當時的法規參數）
  PayrollRecord  期 × 員工——會計師輸入的出勤數字，以及算出來的結果
  PayrollLine    期 × 員工 × 一列——法規以外的加項與扣項（獎金、借支）

為什麼把「算出來的結果」也存起來，而不是每次即時算？
因為薪水發出去之後，那個數字就是歷史事實。法規參數改了、時薪調了，
去年 12 月的薪資單不能跟著變。所以確認時連同算式明細一起凍結。
"""
from decimal import Decimal

from django.conf import settings
from django.db import models

from main.apps.core.models import TimeStampedModel
from main.utils.choices import PayrollLineKind, PayrollStatus


class PayrollPeriod(TimeStampedModel):
    year = models.PositiveSmallIntegerField("年")
    month = models.PositiveSmallIntegerField("月")

    # 系統用「當月平日數 − 國定假日」算出預設值，但一定要能改：
    # 有人排班含週六，有人到職離職只做半個月
    workdays = models.DecimalField(
        "應上班天數", max_digits=5, decimal_places=2, default=Decimal("0"),
        help_text="系統以當月平日扣掉國定假日帶出預設值，可自行調整",
    )
    normal_hours_per_day = models.DecimalField(
        "每日正常工時", max_digits=4, decimal_places=2, default=Decimal("8"),
    )
    daily_ot_hours = models.DecimalField(
        "每日固定加班時數", max_digits=4, decimal_places=2, default=Decimal("0.5"),
        help_text="產生薪資單時自動帶入；某個月不加班就填 0",
    )

    status = models.CharField(
        "狀態", max_length=10, choices=PayrollStatus.choices, default=PayrollStatus.DRAFT,
    )
    # 確認當下的整組法規參數。之後調基本工資不會回頭改動這個月
    policy_snapshot = models.JSONField("法規參數快照", default=dict, blank=True)

    note = models.TextField("備註", blank=True)
    confirmed_at = models.DateTimeField("確認時間", null=True, blank=True)
    confirmed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, verbose_name="確認者",
        null=True, blank=True, on_delete=models.SET_NULL, related_name="+",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, verbose_name="建立者",
        null=True, blank=True, on_delete=models.SET_NULL, related_name="+",
    )

    class Meta:
        db_table = "payroll_period"
        verbose_name = verbose_name_plural = "薪資期間"
        ordering = ["-year", "-month"]
        constraints = [
            models.UniqueConstraint(fields=["year", "month"], name="uniq_payroll_period"),
        ]

    def __str__(self):
        return f"{self.year} 年 {self.month} 月薪資"

    @property
    def is_locked(self):
        """已確認或已發放就不能再改數字——要改必須先退回草稿"""
        return self.status != PayrollStatus.DRAFT

    @property
    def label(self):
        return f"{self.year}-{self.month:02d}"


class PayrollRecord(TimeStampedModel):
    """一個人在某個月的薪資單。

    ⚠️ 前半是**輸入**（會計師照打卡表填），後半是**輸出**（系統算的）。
    輸出欄位不接受前端直接寫入——它們每次存檔都會被重算覆蓋。
    """

    period = models.ForeignKey(
        PayrollPeriod, verbose_name="薪資期間",
        on_delete=models.CASCADE, related_name="records",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, verbose_name="員工",
        on_delete=models.PROTECT, related_name="payroll_records",
    )

    # ── 輸入：出勤 ─────────────────────────────────────────────────
    work_days = models.DecimalField("上班天數", max_digits=6, decimal_places=2, default=Decimal("0"))
    normal_hours = models.DecimalField(
        "正常工時", max_digits=8, decimal_places=2, default=Decimal("0"),
        help_text="不含加班。預設＝上班天數 × 每日正常工時",
    )
    ot_weekday_1_hours = models.DecimalField(
        "平日加班前段時數", max_digits=8, decimal_places=2, default=Decimal("0"),
    )
    ot_weekday_2_hours = models.DecimalField(
        "平日加班後段時數", max_digits=8, decimal_places=2, default=Decimal("0"),
    )
    ot_restday_1_hours = models.DecimalField(
        "休息日前段時數", max_digits=8, decimal_places=2, default=Decimal("0"),
    )
    ot_restday_2_hours = models.DecimalField(
        "休息日中段時數", max_digits=8, decimal_places=2, default=Decimal("0"),
    )
    ot_restday_3_hours = models.DecimalField(
        "休息日超時時數", max_digits=8, decimal_places=2, default=Decimal("0"),
    )
    holiday_hours = models.DecimalField(
        "國定假日出勤時數", max_digits=8, decimal_places=2, default=Decimal("0"),
    )
    unpaid_leave_hours = models.DecimalField(
        "無薪假時數", max_digits=8, decimal_places=2, default=Decimal("0"),
    )
    late_minutes = models.PositiveIntegerField("遲到分鐘", default=0)
    early_leave_minutes = models.PositiveIntegerField("早退分鐘", default=0)

    # ── 輸入：保險計費（D57 第二輪：到職／離職不滿一個月）────────
    # 三種保險的未滿月規則**各不相同**，這是最容易算錯的地方：
    #   勞保、勞退　按日計，分母一律 30（不分大小月）
    #   健保　　　　整月計收，且由「當月最後一天」的投保單位負擔——
    #               所以月中離職的人，這個月公司不扣他健保費
    insured_days = models.PositiveSmallIntegerField(
        "勞保勞退計費天數", default=30,
        help_text="到職當月＝30−到職日+1；離職當月＝離職日；整月＝30",
    )
    charge_health_insurance = models.BooleanField(
        "本月計收健保", default=True,
        help_text="健保不按日拆。月中離職者當月由下一個投保單位負擔，這裡取消勾選",
    )

    # ── 輸入：這個月的個別覆寫 ─────────────────────────────────────
    # 留空＝沿用員工薪資設定。某個月臨時調整不該回頭改設定檔
    hourly_wage = models.DecimalField(
        "時薪（本月覆寫）", max_digits=10, decimal_places=2, null=True, blank=True,
    )
    insured_salary = models.DecimalField(
        "投保薪資（本月覆寫）", max_digits=12, decimal_places=2, null=True, blank=True,
    )
    dependents = models.PositiveSmallIntegerField(
        "健保眷屬口數（本月覆寫）", null=True, blank=True,
    )

    note = models.TextField("備註", blank=True)

    # ── 輸出：系統算的 ─────────────────────────────────────────────
    gross = models.DecimalField("應發總額", max_digits=14, decimal_places=2, default=Decimal("0"))
    deduction = models.DecimalField("應扣總額", max_digits=14, decimal_places=2, default=Decimal("0"))
    net = models.DecimalField("實發金額", max_digits=14, decimal_places=2, default=Decimal("0"))
    employer_cost = models.DecimalField(
        "雇主另負擔", max_digits=14, decimal_places=2, default=Decimal("0"),
        help_text="勞退提繳等公司出的錢，不從薪水扣",
    )
    # 每一行的「標籤 × 算式 × 金額」——會計師要看得到怎麼算出來的，
    # 不是只給一個總數。前端直接照這個陣列渲染。
    detail = models.JSONField("計算明細", default=list, blank=True)
    warnings = models.JSONField("提醒", default=list, blank=True)

    class Meta:
        db_table = "payroll_record"
        verbose_name = verbose_name_plural = "薪資單"
        ordering = ["user__employee_no", "user__username"]
        constraints = [
            models.UniqueConstraint(fields=["period", "user"], name="uniq_payroll_record"),
        ]

    def __str__(self):
        return f"{self.period.label} {self.user.name}"


class PayrollLine(TimeStampedModel):
    """薪資單上手動加的一列。

    法規算得出來的東西不放這裡（那些由 calc_service 產生）。
    這裡是規則以外的錢：全勤獎金、交通津貼、補發、借支、代扣款。
    """

    record = models.ForeignKey(
        PayrollRecord, verbose_name="薪資單",
        on_delete=models.CASCADE, related_name="lines",
    )
    kind = models.CharField("類型", max_length=10, choices=PayrollLineKind.choices)
    label = models.CharField("項目", max_length=50)
    amount = models.DecimalField("金額", max_digits=14, decimal_places=2, default=Decimal("0"))
    note = models.CharField("說明", max_length=200, blank=True)

    class Meta:
        db_table = "payroll_line"
        verbose_name = verbose_name_plural = "薪資加扣項"
        ordering = ["kind", "id"]

    def __str__(self):
        return f"{self.get_kind_display()} {self.label} {self.amount}"
