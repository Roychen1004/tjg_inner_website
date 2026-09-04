"""例行規則 → 逐次待辦（D53）

沒有排程器（8GB 主機不養常駐服務）：使用者瀏覽行政日曆或我的任務時，
順手把該長的待辦長出來（ensure_until）。冪等，(rule, date) 唯一約束擋併發。

「已展開至」（materialized_until）記住長到哪一天——
  · 經理手動刪掉的某一次不會在下次瀏覽時又長回來
  · 規則修改時 resync 只重排今天以後還沒完成的，做完的歷史不動
  · 只往未來長，不回頭補過去（規則的起始日在過去也不會生出一堆逾期）
"""
import calendar
import datetime as dt

from django.db import transaction
from django.utils import timezone

from main.apps.affairs.models import AffairRule, AffairTask
from main.utils.choices import AffairFreq

# 預設往未來長一年多一點——「每年」的下一次也會出現在日曆上
HORIZON_DAYS = 400
# 使用者往未來翻日曆，最多陪他長到兩年
HARD_CAP_DAYS = 730


def occurrence_dates(rule, start, end):
    """規則在 [start, end]（含端點）內的每一個日期"""
    lo = max(start, rule.start_date)
    hi = min(end, rule.end_date) if rule.end_date else end
    if lo > hi:
        return
    if rule.freq == AffairFreq.WEEKLY:
        wanted = {d for d in (rule.weekdays or []) if 0 <= d <= 6}
        day = lo
        while day <= hi:
            if day.weekday() in wanted:
                yield day
            day += dt.timedelta(days=1)
    elif rule.freq == AffairFreq.MONTHLY:
        y, m = lo.year, lo.month
        while (y, m) <= (hi.year, hi.month):
            day = dt.date(y, m, min(rule.month_day, calendar.monthrange(y, m)[1]))
            if lo <= day <= hi:
                yield day
            y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    else:  # YEARLY（2/29 之類的日子在平年以當月月底計）
        for y in range(lo.year, hi.year + 1):
            day = dt.date(
                y, rule.year_month,
                min(rule.year_day, calendar.monthrange(y, rule.year_month)[1]),
            )
            if lo <= day <= hi:
                yield day


def _horizon(until=None):
    today = timezone.localdate()
    want = max(until or today, today + dt.timedelta(days=HORIZON_DAYS))
    return min(want, today + dt.timedelta(days=HARD_CAP_DAYS))


def ensure_until(until=None):
    """把所有啟用規則的待辦長到 until（冪等；日曆與我的任務載入時呼叫）"""
    horizon = _horizon(until)
    # 不 prefetch assignees——大多數規則已展開到位直接跳過，
    # 真的要長的才在 _materialize 裡抓（規則數量級是個位數）
    for rule in AffairRule.objects.filter(is_active=True):
        if rule.materialized_until and rule.materialized_until >= horizon:
            continue
        _materialize(rule, horizon)


def materialize_rule(rule, until=None):
    """單一規則立即展開——建立或修改規則後呼叫，存完馬上看得到"""
    _materialize(rule, _horizon(until))


def _materialize(rule, horizon):
    today = timezone.localdate()
    start = max(rule.start_date, today)   # 只往未來長
    if rule.materialized_until:
        start = max(start, rule.materialized_until + dt.timedelta(days=1))
    members = list(rule.assignees.all())
    for day in occurrence_dates(rule, start, horizon):
        task, created = AffairTask.objects.get_or_create(
            rule=rule, date=day,
            defaults={
                "title": rule.title,
                "category_id": rule.category_id,
                "note": rule.note,
                # 金額與方向由規則帶入，之後可個別改（D55）；
                # 「只是參考」也一起帶（D56）——談定了再逐筆拿掉
                "amount": rule.amount,
                "direction": rule.direction,
                "is_reference": rule.is_reference,
                "created_by_id": rule.created_by_id,
            },
        )
        if created and members:
            task.assignees.set(members)
    if rule.materialized_until is None or horizon > rule.materialized_until:
        rule.materialized_until = horizon
        rule.save(update_fields=["materialized_until", "updated_at"])


@transaction.atomic
def resync(rule):
    """規則修改後重排：今天起還沒完成的砍掉重長，做完的與過去的不動"""
    today = timezone.localdate()
    rule.tasks.filter(is_done=False, date__gte=today).delete()
    horizon = rule.materialized_until   # 原本長到哪就補到哪
    rule.materialized_until = today - dt.timedelta(days=1)
    rule.save(update_fields=["materialized_until", "updated_at"])
    if rule.is_active:
        _materialize(rule, max(horizon or today, _horizon()))
