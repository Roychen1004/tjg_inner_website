"""薪資 API 的序列化器（D57）"""
from decimal import Decimal

from rest_framework import serializers

from main.apps.core.models import User
from main.apps.payroll.models import (
    Holiday,
    InsuranceGrade,
    PayrollLine,
    PayrollPeriod,
    PayrollPolicy,
    PayrollRecord,
    SalaryProfile,
)
from main.apps.payroll.services import calc_service
from main.apps.payroll.services.workday_service import INSURANCE_MONTH_DAYS

# 法規參數：除了主鍵與時間戳，其餘全部可編輯——這正是這張表存在的理由
POLICY_FIELDS = [
    f.name for f in PayrollPolicy._meta.fields
    if f.name not in ("id", "created_at", "updated_at")
]


class PayrollPolicySerializer(serializers.ModelSerializer):
    class Meta:
        model = PayrollPolicy
        fields = ["id", *POLICY_FIELDS]

    def validate(self, data):
        # 費率填成 0.125 而不是 12.5 是最容易犯的錯，而且錯了不會報錯，
        # 只會讓每個人的勞保費變成十分之一——算完才發現就來不及了
        for name in ("labor_insurance_rate", "health_insurance_rate"):
            value = data.get(name)
            if value is not None and Decimal(value) > 0 and Decimal(value) < Decimal("1"):
                raise serializers.ValidationError({
                    name: "費率請填百分比的數字（例如 12.5 代表 12.5%），不是 0.125",
                })
        for name in POLICY_FIELDS:
            value = data.get(name)
            if isinstance(value, Decimal) and value < 0:
                raise serializers.ValidationError({name: "不能是負數"})
        return data


class InsuranceGradeSerializer(serializers.ModelSerializer):
    class Meta:
        model = InsuranceGrade
        fields = ["id", "level", "amount", "is_active"]


class HolidaySerializer(serializers.ModelSerializer):
    class Meta:
        model = Holiday
        fields = ["id", "date", "name", "is_workday"]


class SalaryProfileSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source="user.name", read_only=True)
    pay_type_label = serializers.CharField(source="get_pay_type_display", read_only=True)
    employee_no = serializers.CharField(source="user.employee_no", read_only=True, default=None)
    title = serializers.CharField(source="user.title", read_only=True)

    class Meta:
        model = SalaryProfile
        fields = [
            "id", "user", "user_name", "employee_no", "title",
            "pay_type", "pay_type_label", "monthly_salary",
            "hourly_wage", "insured_salary", "dependents",
            "voluntary_pension_rate", "hire_date", "resign_date", "is_active", "note",
        ]

    def validate_dependents(self, value):
        if value > 20:
            raise serializers.ValidationError("眷屬口數看起來不合理，請確認")
        return value

    def validate_voluntary_pension_rate(self, value):
        if value is not None and not (Decimal("0") <= Decimal(value) <= Decimal("6")):
            raise serializers.ValidationError("勞退自願提繳只能是 0–6%")
        return value

    def validate(self, data):
        def val(name):
            if name in data:
                return data[name]
            return getattr(self.instance, name, None) if self.instance else None

        hire, resign = val("hire_date"), val("resign_date")
        if hire and resign and resign < hire:
            raise serializers.ValidationError({"resign_date": "離職日不能早於到職日"})

        # ⚠️ 這裡刻意**不擋**「選了月薪制但還沒填金額」。
        # 擋下去會變成雞生蛋：月薪欄位要切成月薪制之後才出現，
        # 但切的當下還沒有金額可填——使用者卡在下拉選單前面出不去。
        # 改成放行，然後在薪資單上出現警示、確認整月時擋下來（見 calc_service
        # 與 PayrollPeriodViewSet.confirm），錯誤才會出現在看得到的地方。
        return data


class PayrollLineSerializer(serializers.ModelSerializer):
    kind_label = serializers.CharField(source="get_kind_display", read_only=True)

    class Meta:
        model = PayrollLine
        fields = ["id", "record", "kind", "kind_label", "label", "amount", "note"]

    def validate_label(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("請填項目名稱，例如「全勤獎金」")
        return value

    def validate_amount(self, value):
        if value is not None and value < 0:
            raise serializers.ValidationError(
                "金額不能是負數；要扣錢請把「類型」選成扣項"
            )
        return value


class PayrollRecordSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source="user.name", read_only=True)
    employee_no = serializers.CharField(source="user.employee_no", read_only=True, default=None)
    title = serializers.CharField(source="user.title", read_only=True)
    # 前端要知道這個人是時薪還月薪，才知道哪些欄位該顯示
    pay_type = serializers.CharField(source="user.salary_profile.pay_type", read_only=True, default="hourly")
    pay_type_label = serializers.CharField(
        source="user.salary_profile.get_pay_type_display", read_only=True, default="時薪制",
    )
    profile_monthly_salary = serializers.DecimalField(
        source="user.salary_profile.monthly_salary", max_digits=12, decimal_places=2,
        read_only=True, default=None,
    )
    # 實際採用的平日每小時工資額。月薪制是 月薪 ÷ 240 換算出來的——
    # 加班費、請假扣款都用它，所以要讓會計師看得到那個數字是多少。
    # ★ 由後端算，不讓前端自己除：顯示與計算必須是同一個數
    effective_hourly_wage = serializers.SerializerMethodField()
    lines = PayrollLineSerializer(many=True, read_only=True)

    class Meta:
        model = PayrollRecord
        fields = [
            "id", "period", "user", "user_name", "employee_no", "title",
            # 輸入
            "work_days", "normal_hours",
            "ot_weekday_1_hours", "ot_weekday_2_hours",
            "ot_restday_1_hours", "ot_restday_2_hours", "ot_restday_3_hours",
            "holiday_hours", "unpaid_leave_hours",
            "late_minutes", "early_leave_minutes",
            "insured_days", "charge_health_insurance",
            "hourly_wage", "monthly_salary", "insured_salary", "dependents", "note",
            "pay_type", "pay_type_label", "profile_monthly_salary",
            "effective_hourly_wage",
            # 輸出（唯讀——每次存檔都會重算覆蓋）
            "gross", "deduction", "net", "employer_cost", "detail", "warnings",
            "lines",
        ]
        read_only_fields = ["gross", "deduction", "net", "employer_cost", "detail", "warnings"]


    def get_effective_hourly_wage(self, obj):
        policy = self.context.get("payroll_policy") or PayrollPolicy.get_active()
        profile = getattr(obj.user, "salary_profile", None)
        return str(calc_service.resolve_wage(obj, profile, policy))


class PayrollRecordWriteSerializer(serializers.ModelSerializer):
    # 時數一律取到 0.5 小時（打卡表本來就是以半小時在看的）。
    # 存回去的是修正後的值，畫面上會看到系統把 7.3 收成 7.5——
    # 靜靜地改掉使用者打的數字是不行的，但這裡改完會立刻顯示出來
    HOUR_FIELDS = (
        "normal_hours", "ot_weekday_1_hours", "ot_weekday_2_hours",
        "ot_restday_1_hours", "ot_restday_2_hours", "ot_restday_3_hours",
        "holiday_hours", "unpaid_leave_hours",
    )

    class Meta:
        model = PayrollRecord
        fields = [
            "work_days", "normal_hours",
            "ot_weekday_1_hours", "ot_weekday_2_hours",
            "ot_restday_1_hours", "ot_restday_2_hours", "ot_restday_3_hours",
            "holiday_hours", "unpaid_leave_hours",
            "late_minutes", "early_leave_minutes",
            "insured_days", "charge_health_insurance",
            "hourly_wage", "monthly_salary", "insured_salary", "dependents", "note",
        ]

    def validate_insured_days(self, value):
        if value is not None and value > INSURANCE_MONTH_DAYS:
            raise serializers.ValidationError(
                f"勞保勞退的計費天數以 {INSURANCE_MONTH_DAYS} 日為一個月，不會超過這個數字"
            )
        return value

    def validate(self, data):
        for name, value in data.items():
            if isinstance(value, Decimal) and value < 0:
                raise serializers.ValidationError({name: "時數與金額不能是負數"})
        for name in self.HOUR_FIELDS:
            if data.get(name) is not None:
                data[name] = calc_service.round_half_hour(data[name])
        return data


class PayrollPeriodSerializer(serializers.ModelSerializer):
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    confirmed_by_name = serializers.CharField(
        source="confirmed_by.name", read_only=True, default=None,
    )
    label = serializers.CharField(read_only=True)
    is_locked = serializers.BooleanField(read_only=True)
    totals = serializers.SerializerMethodField()

    class Meta:
        model = PayrollPeriod
        fields = [
            "id", "year", "month", "label", "workdays",
            "normal_hours_per_day", "daily_ot_hours",
            "status", "status_label", "is_locked", "note",
            "confirmed_at", "confirmed_by", "confirmed_by_name",
            "policy_snapshot", "totals",
        ]
        read_only_fields = ["status", "confirmed_at", "confirmed_by", "policy_snapshot"]

    def get_totals(self, obj):
        """整個月的合計。前端的頁首要用，逐筆加總在前端做會漏掉分頁。"""
        records = getattr(obj, "_records_cache", None)
        if records is None:
            records = list(obj.records.all())
        return {
            "headcount": len(records),
            "gross": str(sum((r.gross for r in records), Decimal("0"))),
            "deduction": str(sum((r.deduction for r in records), Decimal("0"))),
            "net": str(sum((r.net for r in records), Decimal("0"))),
            "employer_cost": str(sum((r.employer_cost for r in records), Decimal("0"))),
        }


class PayrollPeriodWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = PayrollPeriod
        fields = [
            "year", "month", "workdays", "normal_hours_per_day", "daily_ot_hours", "note",
        ]
        # 拿掉 model 的 UniqueConstraint 自動產生的驗證器——它會搶在 validate()
        # 前面丟出「The fields year, month must make a unique set.」，
        # 使用者看到一句英文，還是不知道該怎麼辦（鐵律 9）
        validators = []

    def validate_year(self, value):
        if not (2000 <= value <= 2200):
            raise serializers.ValidationError("年份請填西元年，例如 2026")
        return value

    def validate_month(self, value):
        if not (1 <= value <= 12):
            raise serializers.ValidationError("月份請填 1–12")
        return value

    def validate(self, data):
        year = data.get("year", getattr(self.instance, "year", None))
        month = data.get("month", getattr(self.instance, "month", None))
        clash = PayrollPeriod.objects.filter(year=year, month=month)
        if self.instance:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError(
                f"{year} 年 {month} 月已經建立過了，直接到那個月編輯即可"
            )
        return data


class SalaryProfileBulkUserSerializer(serializers.ModelSerializer):
    """給「同步員工名冊」用的精簡員工資料"""

    class Meta:
        model = User
        fields = ["id", "name", "employee_no", "title"]
