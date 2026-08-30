"""產能與成本統計（D52 第一期）

四張統計，全部由既有原始資料自動彙整，不用任何人多填東西：
  1. 員工產能　　＝回報紀錄 × 計工規則（一人一天 1 工，記在有回報的那件）
  2. 公司產能　　＝同上，按工作類型彙總＋逐月走勢
  3. 品項單價　　＝應付明細（數量×單價）按品項累積
  4. 每類流程花費＝應付款（掛流程單元的）按流程名彙總

目的：接案前回答「人力還有沒有餘力、這種案子大概要花多少」。
"""
from collections import defaultdict

from main.apps.payables.models import Payable, PayableLine
from main.apps.tracking.models import AssignmentReport
from main.apps.tracking.services.productivity_service import day_weights

UNTYPED = "未分類"


def _override_scales(assignments):
    """{assignment_id: 比例}——有補登修正的分配，把系統計工按比例縮放成修正值。

    修正值是「這份分配的總工數」，統計期間可能只涵蓋其中幾天，
    所以不能直接拿修正值當期間工數——先算它全期的系統工數，
    得出縮放比例，再套到期間內的每一天上。
    """
    overridden = [a for a in assignments if a.man_days_override is not None]
    if not overridden:
        return {}
    own = AssignmentReport.objects.filter(
        assignment_id__in=[a.pk for a in overridden]
    ).select_related("assignment")
    person_days = {(r.assignment.assignee_id, r.date) for r in own}
    if not person_days:
        return {a.pk: 0.0 for a in overridden}
    siblings = AssignmentReport.objects.filter(
        assignment__assignee_id__in={p for p, _ in person_days},
        date__in={d for _, d in person_days},
    ).select_related("assignment")
    all_weights = day_weights(siblings)
    totals = defaultdict(float)
    for (aid, _), w in all_weights.items():
        totals[aid] += w
    return {
        a.pk: (float(a.man_days_override) / totals[a.pk] if totals.get(a.pk) else 0.0)
        for a in overridden
    }


def productivity_stats(start, end):
    """期間內的員工產能與公司各類型產能。"""
    reports = list(
        AssignmentReport.objects.filter(date__gte=start, date__lte=end)
        .select_related("assignment__work_type", "assignment__task", "assignment__assignee")
    )
    weights = day_weights(reports)
    scales = _override_scales({r.assignment for r in reports})

    # (分配, 日) → 當天的工（含補登縮放）
    md_by_day = {
        (aid, date): w * scales.get(aid, 1.0) for (aid, date), w in weights.items()
    }

    # 彙整鍵：類型與計量單位（噸跟支不能相加，分開列）
    def keys_of(r):
        a = r.assignment
        wt = a.work_type.name if a.work_type else UNTYPED
        return a.assignee, wt, a.task.unit_of_measure or ""

    person_rows = defaultdict(lambda: {"qty": 0.0, "man_days": 0.0})
    company_rows = defaultdict(lambda: {"qty": 0.0, "man_days": 0.0})
    monthly = defaultdict(lambda: defaultdict(lambda: {"qty": 0.0, "man_days": 0.0}))
    counted = set()  # (assignment, date) 的工只計一次（同日多次回報）
    for r in reports:
        assignee, wt, uom = keys_of(r)
        qty = float(r.qty_delta)
        month = f"{r.date.year:04d}-{r.date.month:02d}"
        person_rows[(assignee, wt, uom)]["qty"] += qty
        company_rows[(wt, uom)]["qty"] += qty
        monthly[(wt, uom)][month]["qty"] += qty
        key = (r.assignment_id, r.date)
        if key not in counted:
            counted.add(key)
            md = md_by_day.get(key, 0.0)
            person_rows[(assignee, wt, uom)]["man_days"] += md
            company_rows[(wt, uom)]["man_days"] += md
            monthly[(wt, uom)][month]["man_days"] += md

    def row(base, wt, uom):
        md, qty = base["man_days"], base["qty"]
        return {
            "work_type": wt, "unit_of_measure": uom,
            "qty": round(qty, 2), "man_days": round(md, 2),
            "per_man_day": round(qty / md, 2) if md else None,
        }

    people = defaultdict(list)
    order = {}
    for (assignee, wt, uom), base in person_rows.items():
        people[assignee].append(row(base, wt, uom))
        order[assignee] = (assignee.employee_no or "", assignee.name)
    people_out = [
        {
            "id": u.pk, "name": u.name, "title": u.title,
            "rows": sorted(rows, key=lambda x: -x["man_days"]),
            "man_days": round(sum(x["man_days"] for x in rows), 2),
        }
        for u, rows in sorted(people.items(), key=lambda kv: order[kv[0]])
    ]
    company_out = sorted(
        (
            {
                **row(base, wt, uom),
                "monthly": [
                    {"month": m, "qty": round(v["qty"], 2), "man_days": round(v["man_days"], 2)}
                    for m, v in sorted(monthly[(wt, uom)].items())
                ],
            }
            for (wt, uom), base in company_rows.items()
        ),
        key=lambda x: -x["man_days"],
    )
    return {"people": people_out, "company": company_out}


def unit_price_stats(max_points=100):
    """各品項的採購單價走勢與平均（全期，資料量小不分期）。"""
    lines = PayableLine.objects.select_related(
        "item", "payable__vendor"
    ).order_by("id")
    by_item = defaultdict(list)
    for line in lines:
        p = line.payable
        date = p.billing_date or p.created_at.date()
        by_item[line.item].append({
            "date": date.isoformat(),
            "qty": float(line.qty),
            "unit_price": float(line.unit_price),
            "amount": float(line.amount),
            "vendor": p.vendor.name,
            "payable": p.pk,
            "title": p.title,
        })
    items = []
    for item, points in by_item.items():
        points.sort(key=lambda x: x["date"])
        total_qty = sum(pt["qty"] for pt in points)
        total_amt = sum(pt["amount"] for pt in points)
        items.append({
            "id": item.pk, "name": item.name,
            "unit_of_measure": item.unit_of_measure,
            "count": len(points),
            "total_qty": round(total_qty, 2),
            "avg_price": round(total_amt / total_qty, 2) if total_qty else None,
            "latest_price": points[-1]["unit_price"],
            "points": points[-max_points:],
        })
    items.sort(key=lambda x: x["name"])
    return {"items": items}


def flow_cost_stats():
    """每類流程平均一次花多少錢（掛在流程單元上的應付款，含未付——
    錢已經承諾出去就是這個流程的成本）。"""
    payables = Payable.objects.filter(flow_unit__isnull=False).select_related(
        "flow_unit__flow_item"
    )
    per_unit = defaultdict(float)
    unit_name = {}
    for p in payables:
        per_unit[p.flow_unit_id] += float(p.payable_amount)
        unit_name[p.flow_unit_id] = p.flow_unit.flow_display_name
    by_flow = defaultdict(list)
    for unit_id, total in per_unit.items():
        by_flow[unit_name[unit_id]].append(total)
    rows = [
        {
            "flow_name": name,
            "unit_count": len(totals),
            "total": round(sum(totals), 0),
            "avg": round(sum(totals) / len(totals), 0),
        }
        for name, totals in by_flow.items()
    ]
    rows.sort(key=lambda x: -x["total"])
    return {"rows": rows}
