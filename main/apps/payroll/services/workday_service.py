"""應上班天數與保險計費天數（D57）

兩件事：
  1. 這個月哪幾天要上班——算出薪資期間的預設「應上班天數」，
     並且把整個月攤成一張日曆給會計師確認（她比系統清楚實際排班）
  2. 勞保、勞退、健保各自的計費天數——**三者規則不同**，見下方註解

刻意不做得更聰明：排班本來就不是每家公司都週休二日，真正的答案在
會計師手上，系統只負責省掉她數日曆的時間。所以算出來的每個數字
在畫面上都可以直接改。
"""
import calendar
import datetime as dt
from decimal import Decimal

from main.apps.payroll.models import Holiday

WEEKEND = (calendar.SATURDAY, calendar.SUNDAY)
WEEKDAY_NAMES = "一二三四五六日"

# 日子的四種身分（前端用同一組代號上色）
WORK = "work"          # 上班日
WEEKEND_OFF = "weekend"  # 一般假日（週六、週日）
HOLIDAY = "holiday"    # 國定假日與補假
MAKEUP = "makeup"      # 補班日：本來是週末，但要上班


def month_bounds(year: int, month: int):
    days = calendar.monthrange(year, month)[1]
    return dt.date(year, month, 1), dt.date(year, month, days)


def classify_days(start: dt.date, end: dt.date):
    """把一段期間攤成一天一筆。

    回傳 [{date, day, weekday, kind, name}]——前端直接照這個畫日曆，
    不必在瀏覽器再算一次「這天是不是假日」（算兩次就會有兩種答案）。
    """
    marked = {
        h.date: h for h in Holiday.objects.filter(date__gte=start, date__lte=end)
    }
    out = []
    day = start
    while day <= end:
        mark = marked.get(day)
        is_weekend = day.weekday() in WEEKEND
        if mark and mark.is_workday:
            kind, name = MAKEUP, mark.name
        elif mark:
            kind, name = HOLIDAY, mark.name
        elif is_weekend:
            kind, name = WEEKEND_OFF, "週" + WEEKDAY_NAMES[day.weekday()]
        else:
            kind, name = WORK, ""
        out.append({
            "date": day.isoformat(),
            "day": day.day,
            "weekday": day.weekday(),
            "kind": kind,
            "name": name,
        })
        day += dt.timedelta(days=1)
    return out


def workdays_in_range(start: dt.date, end: dt.date) -> Decimal:
    """區間內要上班的天數。給到職／離職不滿一個月的人用。"""
    if start > end:
        return Decimal("0")
    return Decimal(sum(1 for d in classify_days(start, end) if d["kind"] in (WORK, MAKEUP)))


def month_calendar(year: int, month: int):
    first, last = month_bounds(year, month)
    return classify_days(first, last)


def default_workdays(year: int, month: int) -> Decimal:
    first, last = month_bounds(year, month)
    return workdays_in_range(first, last)


def weekday_count(year: int, month: int) -> int:
    """當月週一至週五的天數（不看國定假日）——說明用，不是計算基礎"""
    days = calendar.monthrange(year, month)[1]
    return sum(
        1 for d in range(1, days + 1)
        if dt.date(year, month, d).weekday() not in WEEKEND
    )


def holidays_in_month(year: int, month: int):
    """當月**會讓上班日變少**的假日：落在週一至週五的國定假日。

    週末的假日不必扣——它本來就不在上班日裡，扣了會少算一天。
    """
    first, last = month_bounds(year, month)
    return [
        h for h in Holiday.objects.filter(date__gte=first, date__lte=last)
        if not h.is_workday and h.date.weekday() not in WEEKEND
    ]


# ── 保險的計費天數 ─────────────────────────────────────────────────
# ⚠️ 三種保險的規則不一樣，混在一起算就會錯：
#
#   勞保／勞退　按日計，**分母一律 30**——不分大小月，也不管 2 月只有 28 天。
#               到職當月＝30 − 到職日 + 1；離職當月＝離職日；
#               同月來又走＝離職日 − 到職日 + 1
#   健保　　　　**不按日**，整月計收，由「當月最後一天」的投保單位負擔。
#               所以月中離職的人，這個月的健保費是下一個單位的事，公司不扣；
#               月底最後一天才離職的，公司要扣整月。
#               到職則相反：不論哪天到職，月底人在公司就扣整月。
INSURANCE_MONTH_DAYS = 30


def insured_days(year: int, month: int, hire_date=None, resign_date=None) -> int:
    """勞保與勞退在這個月的計費天數（0–30）"""
    first, last = month_bounds(year, month)
    if resign_date and resign_date < first:
        return 0
    if hire_date and hire_date > last:
        return 0

    # 大月的 31 日到職，分母只有 30——壓回 30（那天只算 1 天）
    start_day = min(hire_date.day, INSURANCE_MONTH_DAYS) if (
        hire_date and hire_date >= first
    ) else 1

    if resign_date and resign_date < last:
        end_day = min(resign_date.day, INSURANCE_MONTH_DAYS)
    else:
        # 做到月底（含 2 月的 28/29 日、大月的 31 日）＝算到第 30 天。
        # ⚠️ 這裡最容易錯：2 月只有 28 天，但分母是 30，所以 2/2 到職做到
        # 2/28 是 29 天而不是 27 天——少算的那兩天是勞工的錢
        end_day = INSURANCE_MONTH_DAYS
    return max(0, end_day - start_day + 1)


def charge_health_insurance(year: int, month: int, hire_date=None, resign_date=None) -> bool:
    """這個月公司要不要扣他的健保費——看月底最後一天他還在不在職"""
    first, last = month_bounds(year, month)
    if hire_date and hire_date > last:
        return False
    # 月中離職＝月底那天已經不在，健保由下一個投保單位負擔
    return not (resign_date and resign_date < last)
