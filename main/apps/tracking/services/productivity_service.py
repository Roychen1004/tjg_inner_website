"""產能計工（D52）

計工規則（老闆 2026-08-30 定）：
  一人一天＝1 工（最小單位）。當天的工記在**有回報的那件**分配上；
  同日多件都有回報就均分當天 1 工；沒回報的天不計。
  經理可用 `man_days_override` 直接蓋過某份分配的總工數。

實作上「一天的工屬於誰」只看回報紀錄（AssignmentReport），
所以員工照老闆定的流程「當日工作結束回報」，工數就自動對。
"""
from collections import defaultdict

from main.apps.tracking.models import AssignmentReport


def day_weights(reports):
    """回報列表 → {(assignment_id, date): 當天分到的工}。

    reports 需可讀 assignment 的 assignee_id（先 select_related("assignment")，
    不然一列一查）。同一人同一天回報了 n 件不同分配，每件分 1/n 工；
    同一件當天回報多次仍只算一件。
    """
    per_person_day = defaultdict(set)   # (assignee_id, date) → {assignment_id}
    for r in reports:
        per_person_day[(r.assignment.assignee_id, r.date)].add(r.assignment_id)
    weights = {}
    for (_, date), assignment_ids in per_person_day.items():
        share = 1.0 / len(assignment_ids)
        for aid in assignment_ids:
            weights[(aid, date)] = share
    return weights


def man_days_for(assignments):
    """一批分配 → {assignment_id: 總工數}（含補登修正）。

    要算某份分配的工，得知道它的負責人在那些天**還回報了哪些別件**
    （均分的分母），所以先撈目標的回報、再撈同人同日的所有回報。
    """
    assignments = list(assignments)
    if not assignments:
        return {}
    target_ids = {a.pk for a in assignments}
    own = AssignmentReport.objects.filter(assignment_id__in=target_ids).select_related("assignment")
    person_days = {(r.assignment.assignee_id, r.date) for r in own}
    if not person_days:
        siblings = []
    else:
        # 同人同日的全部回報（含別件分配）才是均分的分母。
        # 撈「人∈…且日∈…」的超集即可——day_weights 按 (人,日) 分組，
        # 多撈到的組合只會產生用不到的 key，不影響結果
        siblings = AssignmentReport.objects.filter(
            assignment__assignee_id__in={p for p, _ in person_days},
            date__in={d for _, d in person_days},
        ).select_related("assignment")

    weights = day_weights(siblings)
    totals = defaultdict(float)
    for (aid, _date), w in weights.items():
        if aid in target_ids:
            totals[aid] += w

    result = {}
    for a in assignments:
        if a.man_days_override is not None:
            result[a.pk] = float(a.man_days_override)
        else:
            result[a.pk] = round(totals.get(a.pk, 0.0), 2)
    return result


def record_report(assignment, actor, qty_done=None, delta=None, date=None):
    """回報完成量：更新分配並寫入不可變的回報紀錄。

    回傳 (assignment, report)。qty_done 與 delta 擇一；
    回報視同已開始（started_at 沒設就補當天）；
    報滿分配量的那天記 completed_at，之後又往回改就清掉。
    """
    from decimal import Decimal

    from django.utils import timezone

    date = date or timezone.localdate()
    before = assignment.qty_done
    if delta is not None:
        after = before + Decimal(str(delta))
    else:
        after = Decimal(str(qty_done))
    if after < 0:
        after = Decimal("0")
    if after > assignment.qty_assigned:
        after = assignment.qty_assigned

    assignment.qty_done = after
    if assignment.started_at is None:
        assignment.started_at = date
    if assignment.is_done and assignment.completed_at is None:
        assignment.completed_at = date
    elif not assignment.is_done:
        assignment.completed_at = None
    assignment.save(update_fields=["qty_done", "started_at", "completed_at", "updated_at"])

    report = None
    if after != before:
        report = AssignmentReport.objects.create(
            assignment=assignment, date=date, qty_delta=after - before, reported_by=actor,
        )
    return assignment, report


def stamp_after_change(assignment, actor, before_qty, date=None):
    """PATCH 直接改了 qty_done 之後補記：寫回報紀錄＋蓋開始／完成日。

    經理在面板上直接修完成量也是一種補登——一樣要進流水帳，
    不然那段量在產能統計裡會憑空消失。
    """
    from django.utils import timezone

    date = date or timezone.localdate()
    updates = []
    if assignment.qty_done != before_qty:
        AssignmentReport.objects.create(
            assignment=assignment, date=date,
            qty_delta=assignment.qty_done - before_qty, reported_by=actor,
        )
        if assignment.started_at is None:
            assignment.started_at = date
            updates.append("started_at")
    if assignment.is_done and assignment.completed_at is None:
        assignment.completed_at = date
        updates.append("completed_at")
    elif not assignment.is_done and assignment.completed_at is not None:
        assignment.completed_at = None
        updates.append("completed_at")
    if updates:
        assignment.save(update_fields=updates + ["updated_at"])
