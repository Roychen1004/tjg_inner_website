"""
現金流預測

**這個模組只回答一個問題：未來哪個月會缺錢？**

不是「顯示所有財務資料」。畫面上唯一重要的是累計淨額跌破零的那一格，
其餘所有東西都是為了讓那一格可信。

三件事讓它可信：

  ① **確定性分級**（決策 D31）
     已請款等收的錢，跟里程碑日期是人填的錢，不能加在一起變成一個
     看起來精確、實際上騙人的數字。分三級，可以只看「確定」——
     那是最壞情況下的現金流。

  ② **含稅**（B2）
     合約談未稅，但實際進出帳戶的是含稅。全部用含稅算，
     否則每一格都少 5%，而且是往樂觀的方向少。

  ③ **支票用兌現日**（B1）
     開票日 ≠ 兌現日，中間可能還有 60–90 天。用開票日算，
     現金流會早兩三個月，看起來安全的那一週實際上會缺錢。

⚠️ **這不是公司的全部現金流。** 專案的應收應付，加上行政事項填了金額的那些
（D55：網路費、清潔費這類），薪資與沒建在系統裡的固定支出還是不含在內。
輸出一定帶著 `disclaimer`，畫面必須顯示它——
不寫這句，看的人會以為累計是正的就沒事。

同一份資料的第二個角度是 `ledger()`（D55，金流 → 收支明細）：
不分格、不算累計，就是一本依日期排的流水帳，而且**連已經發生的也列**
（已收款、已付款、做完的行政事項）。預測看未來，明細看全部。
"""
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

from django.db.models import Q, Sum
from django.utils import timezone

from main.apps.affairs.models import AffairTask
from main.apps.billing.models import BillingMilestone
from main.apps.payables.models import Payable, Subcontract
from main.apps.payables.services import terms_service
from main.utils.choices import (
    Certainty,
    MilestoneState,
    MoneyDirection,
    PayableState,
    SubcontractStatus,
)

DISCLAIMER = (
    "這是**系統裡有的錢**：專案的應收應付，加上行政事項填了金額的那些（D55）。"
    "薪資、以及沒有建在系統裡的固定支出不含在內——公司整體現金部位請再扣掉它們。"
)

# D48（老闆確認）：所有金額一律是稅後——現金流直接用存的數字，不再 ×1.05


# ── 分桶 ───────────────────────────────────────────────────────────
def _week_start(day: date) -> date:
    """以週一為一週的開始"""
    return day - timedelta(days=day.weekday())


def build_buckets(start: date, periods: int, granularity: str):
    """產生時間軸的格子。

    先產生格子再往裡面放錢，而不是照資料的日期分組——
    否則沒有任何款項的那一週會整格消失，時間軸看起來是連續的，
    實際上跳過了幾週。**空的格子本身就是資訊。**
    """
    buckets = []
    if granularity == "month":
        y, m = start.year, start.month
        for _ in range(periods):
            first = date(y, m, 1)
            y, m = (y + 1, 1) if m == 12 else (y, m + 1)
            buckets.append({"key": f"{first:%Y-%m}", "label": f"{first.month}月",
                            "start": first, "end": date(y, m, 1) - timedelta(days=1)})
    else:
        cursor = _week_start(start)
        for _ in range(periods):
            end = cursor + timedelta(days=6)
            week_of_month = (cursor.day - 1) // 7 + 1
            buckets.append({"key": f"{cursor:%Y-%m-%d}", "label": f"{cursor.month}月{week_of_month}週",
                            "start": cursor, "end": end})
            cursor = end + timedelta(days=1)
    return buckets


def _place(buckets, day):
    """這一天落在哪一格。落在範圍外就不放——**不四捨五入到最近的一格**。

    把三個月後的錢硬塞進最後一格，會讓那一格看起來很有錢。
    """
    if day is None:
        return None
    for index, bucket in enumerate(buckets):
        if bucket["start"] <= day <= bucket["end"]:
            return index
    return None


# ── 收入 ───────────────────────────────────────────────────────────
def collect_inflows(window_end, projects, today):
    """三種來源，三種確定性。

    刻意不把「已收款」算進來——那筆錢已經在帳上了，
    預測的是**還沒發生的事**。混進去會讓累計看起來很漂亮。
    """
    rows = []

    milestones = (
        BillingMilestone.objects.filter(project__in=projects)
        .exclude(state=MilestoneState.RECEIVED)
        .select_related("project__customer", "trigger_unit")
    )
    for m in milestones:
        customer = m.project.customer
        term_type = customer.payment_term_type
        term_days = customer.payment_term_days

        if m.state == MilestoneState.INVOICED:
            # 單已經開出去了，等收——只差客戶付款
            when = m.due_date or terms_service.due_date(m.invoice_date, term_type, term_days)
            certainty = Certainty.CONFIRMED
            note = f"已請款{'（' + m.invoice_no + '）' if m.invoice_no else ''}"
        elif m.state == MilestoneState.CLAIMABLE:
            # 可請款但還沒開單。加上開單作業天數——
            # 假設今天就開出去，等於高估了速度
            base = today + timedelta(days=terms_service.INVOICE_LEAD_DAYS)
            when = terms_service.due_date(base, term_type, term_days)
            certainty = Certainty.LIKELY
            note = "可請款，尚未開單"
        else:
            # 未到期：日期是人填的，所以是「預估」。
            # 沒填預計請款日就用觸發流程的預計完成日（甘特排程餵金流預測）；
            # 兩個都沒有的完全不列——不知道什麼時候的錢，放在任何一格都是編的
            base = m.forecast_date
            if not base or base > window_end:
                continue
            when = terms_service.due_date(base, term_type, term_days)
            certainty = Certainty.ESTIMATED
            source = "" if m.expected_date else "（取自觸發流程的排程）"
            note = f"預計 {base} 可請款{source}"

        rows.append({
            "date": when, "amount": m.amount, "certainty": certainty,
            "party": customer.name, "project": m.project.name,
            "title": m.label, "note": note,
            "kind": "milestone", "id": m.pk, "source_kind": "project",
        })
    return rows


# ── 支出 ───────────────────────────────────────────────────────────
def collect_outflows(window_end, projects, today):
    rows = []

    payables = (
        Payable.objects.filter(project__in=projects)
        .exclude(state=PayableState.PAID)
        .select_related("vendor", "project", "subcontract")
    )
    for payable in payables:
        certainty = (
            Certainty.CONFIRMED if payable.state == PayableState.APPROVED else Certainty.LIKELY
        )
        note = payable.get_state_display()
        if payable.check_due_date:
            note += f"（支票 {payable.check_due_date} 兌現）"
        rows.append({
            # ★ cash_date：支票看兌現日，其餘看付款日
            "date": payable.cash_date,
            "amount": payable.payable_amount, "certainty": certainty,
            "party": payable.vendor.name, "project": payable.project.name,
            "title": payable.title, "note": note,
            "kind": "payable", "id": payable.pk, "source_kind": "project",
        })

    # 合約還沒計價的部分：依剩餘工期均攤。這是最軟的一級，
    # 但少了它，長期的支出會憑空消失——包商不會因為還沒送單就不用付錢
    contracts = (
        Subcontract.objects.filter(project__in=projects, status=SubcontractStatus.ACTIVE)
        .with_billed()
        .select_related("vendor", "project")
    )
    for contract in contracts:
        remaining = contract.remaining_amount
        if remaining <= 0:
            continue
        for when, amount in _spread(contract, remaining, today, window_end):
            rows.append({
                "date": when, "amount": amount, "certainty": Certainty.ESTIMATED,
                "party": contract.vendor.name, "project": contract.project.name,
                "title": f"{contract.title}（未計價餘額均攤）",
                "note": f"合約剩 {remaining:,.0f} 元未計價",
                "kind": "subcontract", "id": contract.pk, "source_kind": "project",
            })
    return rows


def _spread(contract, remaining, today, window_end):
    """把合約剩餘額平均攤到剩下的月份。

    合約沒填預計完成日就全部放在窗口的第一個月——
    寧可讓它出現得太早（保守），也不要讓它消失。
    """
    end = contract.end_date or today
    months = max((end.year - today.year) * 12 + end.month - today.month, 0) + 1
    per_month = (remaining / months).quantize(Decimal("1"))

    out = []
    y, m = today.year, today.month
    for _ in range(months):
        when = date(y, m, 15)  # 月中，避開月初月底的邊界
        if when >= today and when <= window_end:
            out.append((when, per_month))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out



# ── 行政收支（D55）─────────────────────────────────────────────────
#: 行政事項在時間軸與明細裡的來源名稱（案子那一側放的是專案名）
AFFAIR_GROUP = "行政事項"


def collect_affairs(window_start, window_end, include_done=False):
    """行政事項裡**填了金額**的那些——網路費、清潔費、規費、報稅。

    金額 0 的不算：那是純待辦（打掃、送件），根本不碰錢。
    標成「只是參考」的也不算（D56）：那是還沒談定的估價，
    混進帳本與累計線，數字就不是錢了。

    預測只看還沒做的：做完＝錢已經付掉了，跟「已付款不列入預測」同一條規矩。
    收支明細要看歷史，所以帶 include_done=True 把做完的也拿出來。
    """
    tasks = (
        AffairTask.objects.filter(
            amount__gt=0, is_reference=False,
            date__gte=window_start, date__lte=window_end,
        )
        .select_related("category")
    )
    if not include_done:
        tasks = tasks.filter(is_done=False)

    rows = []
    for task in tasks:
        rows.append({
            "date": task.date,
            "amount": task.amount,
            # 行政收支是排定好的固定收付（每月網路費就是那個數字），確定性最高
            "certainty": Certainty.CONFIRMED,
            "party": task.category.name,
            "project": AFFAIR_GROUP,
            "title": task.title,
            "note": (
                "已完成" if task.is_done
                else "逾期未處理" if task.is_overdue
                else "尚未處理"
            ),
            "kind": "affair", "id": task.pk, "source_kind": "affair",
            "direction": task.direction,
            "is_done": task.is_done,
        })
    return rows


# ── 組裝 ───────────────────────────────────────────────────────────
def forecast(projects, periods=12, granularity="week", certainties=None, today=None,
             opening_balance=None, include_affairs=True):
    """回傳整張表。

    `certainties` 是要納入計算的等級（預設全部）。
    只勾「確定」時看到的就是最壞情況——那是這個功能真正有用的模式。

    `opening_balance`（D49）：公司現有現金。有給的話「累計」列從這個數字
    起算（缺口＝現金真的見底，不是專案收支軋不平）；沒給（None）照舊從 0。

    `include_affairs`（D55）：把行政事項的收支也算進來。看**單一專案**時
    關掉——公司的網路費不屬於任何一個案子，混進去那個案子的現金流就不對了。
    """
    today = today or timezone.localdate()
    allowed = set(certainties or Certainty.values)
    buckets = build_buckets(today, periods, granularity)

    window_end = buckets[-1]["end"]
    inflow = collect_inflows(window_end, projects, today)
    outflow = collect_outflows(window_end, projects, today)
    if include_affairs:
        affairs = collect_affairs(today, window_end)
        inflow += [r for r in affairs if r["direction"] == MoneyDirection.IN]
        outflow += [r for r in affairs if r["direction"] == MoneyDirection.OUT]

    cells = [
        {
            "key": b["key"], "label": b["label"],
            "start": b["start"], "end": b["end"],
            "inflow": defaultdict(Decimal), "outflow": defaultdict(Decimal),
            "details": [],
        }
        for b in buckets
    ]

    dropped = {"in": Decimal("0"), "out": Decimal("0")}
    for direction, rows in (("in", inflow), ("out", outflow)):
        for row in rows:
            index = _place(buckets, row["date"])
            if index is None:
                dropped[direction] += row["amount"]
                continue
            if row["certainty"] not in allowed:
                continue
            cell = cells[index]
            cell["inflow" if direction == "in" else "outflow"][row["certainty"]] += row["amount"]
            cell["details"].append({**row, "direction": direction})

    running = opening_balance if opening_balance is not None else Decimal("0")
    out_cells = []
    shortfall = None
    for cell in cells:
        income = sum(cell["inflow"].values())
        expense = sum(cell["outflow"].values())
        net = income - expense
        running += net
        if shortfall is None and running < 0:
            shortfall = {"key": cell["key"], "label": cell["label"], "amount": str(-running)}
        out_cells.append({
            "key": cell["key"], "label": cell["label"],
            "start": str(cell["start"]), "end": str(cell["end"]),
            "income": str(income), "expense": str(expense),
            "net": str(net), "cumulative": str(running),
            "income_by_certainty": {k: str(v) for k, v in cell["inflow"].items()},
            "expense_by_certainty": {k: str(v) for k, v in cell["outflow"].items()},
            "detail_count": len(cell["details"]),
            "details": sorted(
                (
                    {
                        "direction": d["direction"], "date": str(d["date"]),
                        "amount": str(d["amount"]), "certainty": d["certainty"],
                        "party": d["party"], "project": d["project"],
                        "title": d["title"], "note": d["note"],
                        "kind": d["kind"], "id": d["id"],
                        # D55：案子的錢還是行政的錢——時間軸與明細靠這個分行
                        "source_kind": d.get("source_kind", "project"),
                    }
                    for d in cell["details"]
                ),
                key=lambda d: (d["direction"], d["date"]),
            ),
        })

    return {
        "granularity": granularity,
        "periods": periods,
        "generated_at": str(today),
        "cells": out_cells,
        "shortfall": shortfall,
        # D49：null＝這個人看不到（或看單一專案）；有值＝累計已含這筆期初現金
        "opening_balance": str(opening_balance) if opening_balance is not None else None,
        "totals": {
            "income": str(sum(Decimal(c["income"]) for c in out_cells)),
            "expense": str(sum(Decimal(c["expense"]) for c in out_cells)),
            "net": str(sum(Decimal(c["net"]) for c in out_cells)),
        },
        # 落在窗口外的錢。不顯示的話，使用者會以為總額就是全部——
        # 「這張表沒把什麼算進去」跟表裡的數字一樣重要
        "outside_window": {
            "income": str(dropped["in"]),
            "expense": str(dropped["out"]),
        },
        "certainty_levels": [
            {"value": v, "label": label} for v, label in Certainty.choices
        ],
        "disclaimer": DISCLAIMER,
        "tax_note": "金額即實際收付金額（稅後）——系統不另外加稅",
    }


# ── 收支明細（D55）─────────────────────────────────────────────────
def _row_out(row, direction, state):
    """把收集器的列轉成明細的一列（日期、金額一律轉字串）"""
    return {
        "date": str(row["date"]),
        "direction": direction,
        "amount": str(row["amount"]),
        # actual＝錢已經進出了（已收款、已付款、做完的行政事項）
        # planned＝還沒發生，是預測
        "state": state,
        "certainty": row["certainty"],
        "source_kind": row.get("source_kind", "project"),
        "source": row["project"],
        "party": row["party"],
        "title": row["title"],
        "note": row["note"],
        "kind": row["kind"],
        "id": row["id"],
    }


def ledger(projects, start, end, sources=None, direction=None, today=None):
    """一本依日期排的流水帳：這一天收了什麼、付了什麼、是哪個案子或哪件行政。

    跟 forecast() 是同一份資料的兩個角度：
      · forecast 分格、算累計，只看**還沒發生**的錢（回答「哪個月會缺錢」）
      · ledger 不分格、不算累計，**已經發生的也列**（回答「錢花到哪裡去了」）

    `sources`：{"project", "affair"} 的子集——畫面上的「全部／只看案子／只看行政」。
    `direction`："in"｜"out" 只看單一方向。
    """
    today = today or timezone.localdate()
    sources = set(sources or ("project", "affair"))
    rows = []

    if "project" in sources:
        # ① 已經發生的：用**實際**的收付日，不是預計日
        received = (
            BillingMilestone.objects.filter(
                project__in=projects, state=MilestoneState.RECEIVED,
                receive_date__gte=start, receive_date__lte=end,
            )
            .select_related("project__customer")
        )
        for m in received:
            rows.append(_row_out({
                "date": m.receive_date, "amount": m.amount,
                "certainty": Certainty.CONFIRMED,
                "party": m.project.customer.name, "project": m.project.name,
                "title": m.label, "note": "已收款",
                "kind": "milestone", "id": m.pk, "source_kind": "project",
            }, "in", "actual"))

        paid = (
            Payable.objects.filter(
                project__in=projects, state=PayableState.PAID,
                paid_date__gte=start, paid_date__lte=end,
            )
            .select_related("vendor", "project")
        )
        for p in paid:
            rows.append(_row_out({
                "date": p.paid_date, "amount": p.payable_amount,
                "certainty": Certainty.CONFIRMED,
                "party": p.vendor.name, "project": p.project.name,
                "title": p.title, "note": f"已付款（{p.get_payment_method_display()}）",
                "kind": "payable", "id": p.pk, "source_kind": "project",
            }, "out", "actual"))

        # ② 還沒發生的：跟現金流預測同一套算法，避免兩個畫面各說各話
        for row in collect_inflows(end, projects, today):
            if row["date"] and start <= row["date"] <= end:
                rows.append(_row_out(row, "in", "planned"))
        for row in collect_outflows(end, projects, today):
            if row["date"] and start <= row["date"] <= end:
                rows.append(_row_out(row, "out", "planned"))

    if "affair" in sources:
        for row in collect_affairs(start, end, include_done=True):
            rows.append(_row_out(
                row, row["direction"], "actual" if row["is_done"] else "planned",
            ))

    if direction in ("in", "out"):
        rows = [r for r in rows if r["direction"] == direction]

    # 同一天的排法：先收後付，再依金額大到小——一天裡最大的那筆先看到
    rows.sort(key=lambda r: (r["date"], r["direction"], -Decimal(r["amount"])))

    days = []
    totals = defaultdict(Decimal)
    for row in rows:
        if not days or days[-1]["date"] != row["date"]:
            days.append({"date": row["date"], "income": Decimal("0"),
                         "expense": Decimal("0"), "rows": []})
        day = days[-1]
        bucket = "income" if row["direction"] == "in" else "expense"
        day[bucket] += Decimal(row["amount"])
        totals[bucket] += Decimal(row["amount"])
        totals[f"{row['state']}_{bucket}"] += Decimal(row["amount"])
        day["rows"].append(row)

    for day in days:
        day["net"] = str(day["income"] - day["expense"])
        day["income"] = str(day["income"])
        day["expense"] = str(day["expense"])

    return {
        "start": str(start),
        "end": str(end),
        "count": len(rows),
        "days": days,
        "totals": {
            "income": str(totals["income"]),
            "expense": str(totals["expense"]),
            "net": str(totals["income"] - totals["expense"]),
            "actual_income": str(totals["actual_income"]),
            "actual_expense": str(totals["actual_expense"]),
            "planned_income": str(totals["planned_income"]),
            "planned_expense": str(totals["planned_expense"]),
        },
        "disclaimer": DISCLAIMER,
    }


# ── 專案損益 ───────────────────────────────────────────────────────
def project_pnl(project):
    """有了應付，毛利就是同一份資料換個角度看。

    刻意用**未稅**：稅是代收代付，不是公司的收入或成本。
    現金流看含稅（實際進出多少錢），損益看未稅（實際賺多少）——
    兩個問題不一樣，答案的口徑也不該一樣。
    """
    revenue = project.effective_amount
    payables = Payable.objects.filter(project=project).aggregate(
        billed=Sum("amount"),
        paid=Sum("amount", filter=Q(state=PayableState.PAID)),
    )
    contracted = Subcontract.objects.filter(project=project).exclude(
        status=SubcontractStatus.CLOSED
    ).aggregate(total=Sum("contract_amount"))["total"] or Decimal("0")

    billed_cost = payables["billed"] or Decimal("0")
    # 已簽合約但還沒計價的部分也是成本——只看已計價會讓毛利虛胖
    committed_cost = max(contracted, billed_cost)

    def margin(cost):
        gross = revenue - cost
        return {
            "cost": str(cost),
            "gross": str(gross),
            "pct": round(float(gross / revenue * 100), 1) if revenue else None,
        }

    return {
        "project_id": project.pk,
        "project_name": project.name,
        "revenue": str(revenue),
        "received": str(project.received_amount),
        # 兩個口徑都給：只看已計價會太樂觀，只看已簽約在案子後期會太悲觀
        "billed": margin(billed_cost),
        "committed": margin(committed_cost),
        "paid_amount": str(payables["paid"] or 0),
        "note": (
            "成本只含工程支出（材料、分包、外包、運輸），"
            "不含薪資與管理費用。金額為未稅"
        ),
    }
