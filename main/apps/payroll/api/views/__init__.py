"""薪資 API（D57）

整組端點只有經理、會計師與系統管理員進得來（view_payroll／edit_payroll）。
員工與檢視角色連分頁都不會出現——不是擋住，是不存在。

⚠️ 「算」這件事只有一條路徑：calc_service.calculate()。
   試算與存檔用同一個函式，才不會出現「畫面試算是這個數、存下去變另一個數」。
"""
from decimal import Decimal
from urllib.parse import quote

from django.db import transaction
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

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
from main.apps.payroll.reference import REFERENCE_DOCUMENTS
from main.apps.payroll.serializers import (
    HolidaySerializer,
    InsuranceGradeSerializer,
    PayrollLineSerializer,
    PayrollPeriodSerializer,
    PayrollPeriodWriteSerializer,
    PayrollPolicySerializer,
    PayrollRecordSerializer,
    PayrollRecordWriteSerializer,
    SalaryProfileSerializer,
)
from main.apps.payroll.services import (
    calc_service,
    calendar_import,
    payroll_export,
    workday_service,
)
from main.utils.choices import PayrollStatus
from main.utils.exceptions import BusinessRuleError
from main.utils.permissions import HasPermission, has_permission
from main.utils.viewsets import BaseModelViewSet


def recalculate(record, policy=None):
    """重算一張薪資單並存回去。改了任何輸入都要走這裡。"""
    result = calc_service.calculate(record, policy=policy)
    for field, value in result.items():
        setattr(record, field, value)
    record.save(update_fields=[
        "gross", "deduction", "net", "employer_cost", "detail", "warnings", "updated_at",
    ])
    return record


def guard_unlocked(period):
    """已確認的月份不接受修改——要改先退回草稿（鐵律 5）"""
    if period.is_locked:
        raise BusinessRuleError(
            f"{period.label} 已經{period.get_status_display()}，不能再改。"
            "要修改請先按「退回草稿」。"
        )


def _denied(message):
    return Response(
        {"type": "permission_denied", "detail": message},
        status=status.HTTP_403_FORBIDDEN,
    )


class PayrollPolicyView(APIView):
    """法規參數。整個系統只有一組，所以是固定路徑的單一物件，不是列表。

        GET   /payroll-policy
        PATCH /payroll-policy
    """

    permission_classes = [IsAuthenticated, HasPermission]
    read_permission = required_permission = "view_payroll"

    def get(self, request):
        return Response(PayrollPolicySerializer(PayrollPolicy.get_active()).data)

    def patch(self, request):
        if not has_permission(request.user, "edit_payroll"):
            return _denied("你沒有修改薪資參數的權限")
        policy = PayrollPolicy.get_active()
        serializer = PayrollPolicySerializer(policy, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class PayrollReferenceView(APIView):
    """政府公告的級距表連結（GET /payroll-references）。

    只給官方頁面網址，系統裡不放 PDF 副本——法規每年修，
    留副本就會有「系統裡那份是舊的」的問題。
    """

    permission_classes = [IsAuthenticated, HasPermission]
    required_permission = "view_payroll"

    def get(self, request):
        return Response(REFERENCE_DOCUMENTS)


class InsuranceGradeViewSet(BaseModelViewSet):
    """投保薪資分級表。級距每年跟著基本工資調，所以做成可維護的主檔。"""

    queryset = InsuranceGrade.objects.all()
    serializer_class = InsuranceGradeSerializer
    pagination_class = None
    read_permission = "view_payroll"
    write_permission = "edit_payroll"

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.query_params.get("active") != "false":
            qs = qs.filter(is_active=True)
        return qs.order_by("level")


class HolidayViewSet(BaseModelViewSet):
    """國定假日。只影響「應上班天數」的預設值。"""

    queryset = Holiday.objects.all()
    serializer_class = HolidaySerializer
    pagination_class = None
    read_permission = "view_payroll"
    write_permission = "edit_payroll"

    def get_queryset(self):
        qs = super().get_queryset()
        if year := self.request.query_params.get("year"):
            qs = qs.filter(date__year=year)
        return qs.order_by("date")


    @action(detail=False, methods=["post"])
    def import_year(self, request):
        """從政府資料開放平臺匯入某一年的辦公日曆表。

        POST /payroll-holidays/import_year?year=2027
        """
        if not has_permission(request.user, "edit_payroll"):
            return _denied("你沒有維護國定假日的權限")
        try:
            year = int(request.query_params.get("year"))
        except (TypeError, ValueError) as exc:
            raise BusinessRuleError("請帶 year，例如 ?year=2027") from exc
        try:
            created, updated, url = calendar_import.import_year(year)
        except calendar_import.CalendarImportError as exc:
            raise BusinessRuleError(str(exc)) from exc
        return Response({
            "created": created, "updated": updated, "source": url,
            "detail": f"{year} 年匯入完成：新增 {created} 天、更新 {updated} 天"
                      "（只記錄跟「平日上班、週末放假」不一樣的日子）",
        })


class SalaryProfileViewSet(BaseModelViewSet):
    """員工薪資設定。名冊直接取系統既有員工，不另建一份。"""

    queryset = SalaryProfile.objects.select_related("user").all()
    serializer_class = SalaryProfileSerializer
    pagination_class = None
    read_permission = "view_payroll"
    write_permission = "edit_payroll"

    def get_queryset(self):
        qs = super().get_queryset()
        # ⚠️ 只有列表才過濾。單筆操作（PATCH 某一張）不能濾——
        # 濾掉的話「不納入薪資計算」就變成單向門：關掉之後連改回來的入口
        # 都找不到，使用者只會看到 404
        if self.action == "list":
            # 系統管理員不是員工，是維護系統的身分——名冊上不該出現。
            # 帳號已停用的也不列，那是「設定 → 員工」的事。
            # 但「不納入薪資計算」的**要**列出來（畫面上灰掉），才有辦法重新勾回來
            qs = qs.filter(user__is_active=True, user__is_superuser=False)
            if self.request.query_params.get("active") == "true":
                qs = qs.filter(is_active=True)
        return qs.order_by("user__employee_no", "user__username")

    def perform_update(self, serializer):
        """存檔後把日期的影響直接套進所有**草稿**月份。

        ★ 使用者的操作順序是「填到職日 → 回月薪資看」，中間不會有人記得
          要再按一次「產生薪資單」。所以這裡自己套用，不要求他多按一步。
          已確認／已發放的月份不動（那是凍結的歷史）。
        """
        serializer.save()
        apply_profile_to_drafts(serializer.instance)

    @action(detail=False, methods=["post"])
    def sync(self, request):
        """替還沒有薪資設定的在職員工各建一張（用法規預設值）。

        新人進來不必記得「還要去薪資那邊建一筆」——按一下就補齊。
        已存在的不動，所以可以重複按。
        """
        if not has_permission(request.user, "edit_payroll"):
            return _denied("你沒有維護薪資設定的權限")
        existing = set(SalaryProfile.objects.values_list("user_id", flat=True))
        policy = PayrollPolicy.get_active()
        created = [
            SalaryProfile(user=user, insured_salary=_grade_for(policy.min_hourly_wage))
            for user in payable_users().exclude(pk__in=existing)
        ]
        SalaryProfile.objects.bulk_create(created)
        # 新人建好設定後，草稿月份的薪資單也一起補上——
        # 不必再叫她回去按一次「產生薪資單」
        for period in PayrollPeriod.objects.filter(status=PayrollStatus.DRAFT):
            sync_records(period, rebaseline_users=set())
        return Response({
            "created": len(created),
            "detail": f"新增 {len(created)} 位員工的薪資設定，草稿月份的薪資單已一併補上"
            if created else "所有在職員工都已經有薪資設定了",
        })


def payable_users():
    """會領薪水的人。

    排除兩種：
      · 停用的帳號——離職的人不該每個月又長出一張薪資單
      · superuser（系統管理員 admin）——那是系統維護用的身分，不是員工
    """
    return User.objects.filter(is_active=True, is_superuser=False)


def _grade_for(hourly_wage):
    """新建薪資設定時的投保薪資預設值：分級表的最低一級。"""
    grade = InsuranceGrade.objects.filter(is_active=True).order_by("level").first()
    return grade.amount if grade else 0


class PayrollPeriodViewSet(BaseModelViewSet):
    """薪資期間（一個月一張）。"""

    queryset = PayrollPeriod.objects.all()
    serializer_class = PayrollPeriodSerializer
    write_serializer_class = PayrollPeriodWriteSerializer
    pagination_class = None
    read_permission = "view_payroll"
    write_permission = "edit_payroll"

    def get_queryset(self):
        return super().get_queryset().prefetch_related("records").order_by("-year", "-month")

    def perform_create(self, serializer):
        policy = PayrollPolicy.get_active()
        data = serializer.validated_data
        # 沒填就用系統算的：當月平日數扣掉國定假日
        if not data.get("workdays"):
            data["workdays"] = workday_service.default_workdays(data["year"], data["month"])
        serializer.save(
            created_by=self.request.user,
            normal_hours_per_day=data.get("normal_hours_per_day") or policy.normal_hours_per_day,
            daily_ot_hours=data.get("daily_ot_hours")
            if data.get("daily_ot_hours") is not None else policy.default_daily_ot_hours,
        )
        # 建好月份就把薪資單建齊——這時候還沒有人 key 過任何東西，
        # 帶入工時基準值是安全的，也省掉「還要再按一個鈕」那一步
        sync_records(serializer.instance, policy=policy)

    def perform_update(self, serializer):
        guard_unlocked(serializer.instance)
        serializer.save()
        # 名冊對齊（補建／移除／保險天數）是安全的，自動做。
        # ⚠️ 但**不**重帶工時——改應上班天數時，會計師可能已經 key 了一半，
        #    要重帶請她自己按「重設工時」
        sync_records(serializer.instance, rebaseline_users=set())

    def perform_destroy(self, instance):
        guard_unlocked(instance)
        instance.delete()

    @action(detail=False, methods=["get"])
    def suggest(self, request):
        """某年某月的建議值：平日幾天、扣掉哪幾個國定假日。

        會計師建立月份前先看到「10 月有 22 個平日，扣掉 2 天國定假日 = 20 天」，
        比直接塞一個數字進去可信。
        """
        try:
            year = int(request.query_params.get("year"))
            month = int(request.query_params.get("month"))
        except (TypeError, ValueError) as exc:
            raise BusinessRuleError("請帶 year 與 month，例如 ?year=2026&month=10") from exc
        if not (1 <= month <= 12):
            raise BusinessRuleError("月份請填 1–12")
        holidays = workday_service.holidays_in_month(year, month)
        policy = PayrollPolicy.get_active()
        days = workday_service.month_calendar(year, month)
        return Response({
            "year": year,
            "month": month,
            "weekdays": workday_service.weekday_count(year, month),
            "holidays": [{"date": h.date, "name": h.name} for h in holidays],
            "workdays": workday_service.default_workdays(year, month),
            "normal_hours_per_day": policy.normal_hours_per_day,
            "daily_ot_hours": policy.default_daily_ot_hours,
            # 整個月一天一筆，前端直接照這個畫日曆——
            # 不讓瀏覽器再算一次「這天是不是假日」（算兩次就會有兩種答案）
            "days": days,
        })

    @action(detail=True, methods=["post"], url_path="reset-hours")
    def reset_hours(self, request, pk=None):
        """把工時基準值重新帶入：`天數 × 每日工時` ＋ `天數 × 每日固定加班`。

        ⚠️ 這會**覆蓋**會計師照打卡表 key 的「應上班天數／正常工時／
           平日加班（前段）」——所以它是明確按下去的動作，不會自動跑。

        建立薪資單、更新保險天數、移除當月不在職者這些**安全的**事，
        系統會在建立月份、改期間設定、改員工設定時自己做（`sync_records`），
        不需要按任何按鈕。

        `?deep=true` 連手填的額外加班、休息日、請假、遲到早退一起歸零，
        等於整個月從頭來過。
        """
        period = self.get_object()
        guard_unlocked(period)
        deep = str(request.query_params.get("deep", "")).lower() in ("1", "true", "yes")
        policy = PayrollPolicy.get_active()

        # 先對齊名冊（該有的有、不該有的沒有），再逐張重帶工時
        result = sync_records(period, policy=policy, rebaseline_users=set())
        first, last = workday_service.month_bounds(period.year, period.month)

        touched = 0
        with transaction.atomic():
            records = period.records.select_related("user", "user__salary_profile")
            for record in records:
                profile = getattr(record.user, "salary_profile", None)
                if profile is None:
                    continue
                span = profile.employed_range(first, last)
                if span is None:
                    continue
                for field, value in hour_defaults(
                    period, workdays_for(period, profile, span, first, last)
                ).items():
                    setattr(record, field, value)
                if deep:
                    for field in RESETTABLE_FIELDS:
                        setattr(record, field, 0)
                record.save()
                recalculate(record, policy)
                touched += 1

        detail = f"已重新帶入 {touched} 張薪資單的工時"
        if deep:
            detail += "，手填的加班、請假、遲到早退一併歸零"
        if result["created"]:
            detail += f"；順便補建 {result['created']} 張"
        if result["removed"]:
            detail += f"；移除 {result['removed']} 張（該月不在職）"
        return Response({"touched": touched, **result, "detail": detail})

    @action(detail=True, methods=["post"])
    def recalc(self, request, pk=None):
        """重算薪資：拿現在的法規參數與員工設定，把金額再算一次。

        **工時完全不動**——這是它跟「重設工時」唯一但關鍵的差別：

          重算薪資　　只重算金額，出勤數字原封不動
                      （改了費率、時薪、投保級距之後按這個）
          重設工時　　把應上班天數／正常工時／平日加班前段**覆蓋**成
                      「天數 × 每日工時」（改了期間設定、想整批重來時才按）

        順便對齊名冊（有人被停用、有人剛加進來時會反映出來），
        但同樣不碰任何人的工時。
        """
        period = self.get_object()
        guard_unlocked(period)
        policy = PayrollPolicy.get_active()
        result = sync_records(period, policy=policy, rebaseline_users=set())
        records = period.records.select_related("user").prefetch_related("lines")
        for record in records:
            recalculate(record, policy)
        detail = f"已重算 {len(records)} 張薪資單（工時未變動）"
        if result["created"]:
            detail += f"，補建 {result['created']} 張"
        if result["removed"]:
            detail += f"，移除 {result['removed']} 張（該月不在職）"
        return Response({"detail": detail, **result})

    @action(detail=True, methods=["get"], url_path="xlsx")
    def xlsx(self, request, pk=None):
        """下載這個月的薪資 Excel（三張表：總表、計算明細、匯款清單）。

        看得到薪資分頁就能下載——這張表裡的東西畫面上本來就看得到，
        不需要另外一道權限。
        """
        period = self.get_object()
        content = payroll_export.build_xlsx(period)
        response = HttpResponse(
            content,
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        quoted = quote(payroll_export.filename(period))
        response["Content-Disposition"] = f"attachment; filename*=UTF-8''{quoted}"
        return response

    @action(detail=True, methods=["post"])
    def confirm(self, request, pk=None):
        """確認：鎖定這個月，並把當下的法規參數凍結起來。"""
        period = self.get_object()
        if period.is_locked:
            raise BusinessRuleError(f"{period.label} 已經{period.get_status_display()}了")
        policy = PayrollPolicy.get_active()
        sync_records(period, policy=policy, rebaseline_users=set())
        if not period.records.exists():
            raise BusinessRuleError(
                "這個月沒有任何薪資單——請先到「員工設定」確認有在職員工，"
                "或按「同步員工名冊」"
            )
        with transaction.atomic():
            for record in period.records.prefetch_related("lines"):
                recalculate(record, policy)
            period.status = PayrollStatus.CONFIRMED
            period.policy_snapshot = policy.snapshot()
            period.confirmed_at = timezone.now()
            period.confirmed_by = request.user
            period.save()
        return Response(PayrollPeriodSerializer(period).data)

    @action(detail=True, methods=["post"])
    def reopen(self, request, pk=None):
        """退回草稿。

        已發放的也退得回來（老闆指示），但錢已經匯出去了——帳面改了追不回來，
        所以會在備註留下「誰、什麼時候退的」。真的算錯時，比較安全的作法
        仍然是在下個月用加項／扣項補正差額。
        """
        period = self.get_object()
        if period.status == PayrollStatus.DRAFT:
            raise BusinessRuleError("這個月本來就是草稿")
        # 已發放也放行（老闆指示）。薪水已經匯出去了，改帳面追不回錢，
        # 所以在備註留下痕跡——之後有人問「為什麼帳跟匯款單對不起來」
        # 至少查得到是誰、什麼時候退的
        if period.status == PayrollStatus.PAID:
            stamp = timezone.localtime().strftime("%Y-%m-%d %H:%M")
            note = f"[{stamp}] {request.user.name} 把已發放的薪資退回草稿"
            period.note = f"{period.note}\n{note}".strip() if period.note else note
        period.status = PayrollStatus.DRAFT
        period.confirmed_at = None
        period.confirmed_by = None
        period.save()
        return Response(PayrollPeriodSerializer(period).data)

    @action(detail=True, methods=["post"])
    def pay(self, request, pk=None):
        """標記為已發放。必須先確認過——沒算完就匯款是本末倒置。"""
        period = self.get_object()
        if period.status == PayrollStatus.DRAFT:
            raise BusinessRuleError("請先「確認」這個月的薪資，再標記發放")
        if period.status == PayrollStatus.PAID:
            raise BusinessRuleError("這個月已經標記為已發放了")
        period.status = PayrollStatus.PAID
        period.save()
        return Response(PayrollPeriodSerializer(period).data)


def _same(a, b):
    """兩個值是不是同一個數（Decimal 的尾數 0 不算差異）"""
    if isinstance(a, Decimal) or isinstance(b, Decimal):
        return Decimal(a) == Decimal(b)
    return a == b


# 「日期算得出來、而且不會覆蓋手 key 資料」的欄位——這些一律自動維護
INSURANCE_FIELDS = ("insured_days", "charge_health_insurance")
# 工時基準值。★ 這三個會蓋掉會計師照打卡表 key 的數字，所以**只在明確按
#   「重設工時」時**才動，不會自動跑
HOUR_FIELDS = ("work_days", "normal_hours", "ot_weekday_1_hours")

# 「重設工時」勾了「連手填的一起歸零」時才清掉的欄位
RESETTABLE_FIELDS = (
    "ot_weekday_2_hours", "ot_restday_1_hours", "ot_restday_2_hours",
    "ot_restday_3_hours", "holiday_hours", "unpaid_leave_hours",
    "late_minutes", "early_leave_minutes",
)


def workdays_for(period, profile, span, first, last):
    """這個人在這個月實際要上幾天班。整月在職就用期間設定的天數。"""
    start, end = span
    if start == first and end == last:
        return period.workdays
    return workday_service.workdays_in_range(start, end)


def hour_defaults(period, workdays):
    """工時基準值＝天數 × 每日工時。這就是「不用手算每月工時」的那一步。"""
    return {
        "work_days": workdays,
        "normal_hours": calc_service.round_half_hour(workdays * period.normal_hours_per_day),
        "ot_weekday_1_hours": calc_service.round_half_hour(workdays * period.daily_ot_hours),
    }


def insurance_defaults(period, profile):
    """勞保勞退天數與健保收不收——純粹從到職／離職日推出來的，沒有手填的意義"""
    return {
        "insured_days": workday_service.insured_days(
            period.year, period.month, profile.hire_date, profile.resign_date,
        ),
        "charge_health_insurance": workday_service.charge_health_insurance(
            period.year, period.month, profile.hire_date, profile.resign_date,
        ),
    }


def sync_records(period, *, policy=None, rebaseline_users=None):
    """把這個月的薪資單「對齊」現在的名冊。**不覆蓋任何手 key 的工時。**

    三件事，都是安全的（沒有東西會被破壞）：
      · 缺的補上——新人、剛同步進來的人（新建的才帶入工時基準值，
        那時候還沒有人 key 過東西）
      · 已存在的，更新勞保勞退天數與健保收不收（從到職離職日推出來的）
      · 該月不在職的人，把那張薪資單收掉——留著數字就是錯的

    ★ 這支會在「建立月份、改期間設定、改員工設定、按重算薪資」時自動跑，
      所以會計師不必記得按任何按鈕。要重新帶入**工時**才需要按「重設工時」。

    `rebaseline_users`：只有這幾個人的工時可以被重帶。改了某人的到職／離職日
    時傳他自己——他的在職期間真的變了，舊天數已經沒有意義。
    ⚠️ 不能只看「天數跟記錄裡的不一樣」就重帶：改期間的應上班天數也會讓
       天數不一樣，那時候重帶就會洗掉會計師 key 到一半的資料。
    """
    if period.is_locked:
        return {"created": 0, "updated": 0, "removed": 0}

    policy = policy or PayrollPolicy.get_active()
    first, last = workday_service.month_bounds(period.year, period.month)
    profiles = SalaryProfile.objects.filter(
        is_active=True, user__is_active=True, user__is_superuser=False,
    ).select_related("user")
    existing = {r.user_id: r for r in period.records.select_related("user")}

    created = updated = 0
    keep = []
    for profile in profiles:
        span = profile.employed_range(first, last)
        if span is None:
            continue
        keep.append(profile.user_id)
        workdays = workdays_for(period, profile, span, first, last)
        record = existing.get(profile.user_id)

        if record is None:
            record = PayrollRecord.objects.create(
                period=period, user=profile.user,
                **hour_defaults(period, workdays),
                **insurance_defaults(period, profile),
            )
            created += 1
        else:
            changes = insurance_defaults(period, profile)
            # 在職期間變了（改了到職／離職日）→ 工時基準也要跟著變，
            # 因為舊的天數已經沒有意義了。純粹改時薪、眷屬口數則不動工時
            may_rebaseline = rebaseline_users is None or profile.user_id in rebaseline_users
            if may_rebaseline and not _same(record.work_days, workdays):
                changes.update(hour_defaults(period, workdays))
            if any(not _same(getattr(record, f), v) for f, v in changes.items()):
                for field, value in changes.items():
                    setattr(record, field, value)
                record.save()
                updated += 1
        recalculate(record, policy)

    stale = period.records.exclude(user_id__in=keep)
    removed = stale.count()
    stale.delete()
    return {"created": created, "updated": updated, "removed": removed}


def apply_profile_to_drafts(profile):
    """一位員工的設定改了 → 把所有**草稿**月份對齊。

    已確認／已發放的月份不動——那是凍結的歷史。
    """
    policy = PayrollPolicy.get_active()
    for period in PayrollPeriod.objects.filter(status=PayrollStatus.DRAFT):
        # 只允許重帶**這個人**的工時：他的到職／離職日變了，天數才有意義地變了。
        # 其他人的工時可能是會計師 key 到一半的，不能碰
        sync_records(period, policy=policy, rebaseline_users={profile.user_id})


class PayrollRecordViewSet(BaseModelViewSet):
    """薪資單。改任何一個輸入欄位，存檔時立刻重算並回傳新的明細。"""

    queryset = PayrollRecord.objects.all()
    serializer_class = PayrollRecordSerializer
    write_serializer_class = PayrollRecordWriteSerializer
    pagination_class = None
    read_permission = "view_payroll"
    write_permission = "edit_payroll"

    def get_queryset(self):
        qs = super().get_queryset().select_related("user", "period").prefetch_related("lines")
        if period := self.request.query_params.get("period"):
            qs = qs.filter(period_id=period)
        return qs.order_by("user__employee_no", "user__username")

    def perform_update(self, serializer):
        guard_unlocked(serializer.instance.period)
        serializer.save()
        recalculate(serializer.instance)

    def perform_destroy(self, instance):
        guard_unlocked(instance.period)
        instance.delete()


class PayrollLineViewSet(BaseModelViewSet):
    """薪資單上手動加的一列（獎金、津貼、借支）。改完連帶重算那張薪資單。"""

    queryset = PayrollLine.objects.select_related("record__period").all()
    serializer_class = PayrollLineSerializer
    pagination_class = None
    read_permission = "view_payroll"
    write_permission = "edit_payroll"

    def get_queryset(self):
        qs = super().get_queryset()
        if record := self.request.query_params.get("record"):
            qs = qs.filter(record_id=record)
        return qs.order_by("kind", "id")

    def perform_create(self, serializer):
        guard_unlocked(serializer.validated_data["record"].period)
        serializer.save()
        recalculate(serializer.instance.record)

    def perform_update(self, serializer):
        guard_unlocked(serializer.instance.record.period)
        serializer.save()
        recalculate(serializer.instance.record)

    def perform_destroy(self, instance):
        guard_unlocked(instance.record.period)
        record = instance.record
        instance.delete()
        recalculate(record)
