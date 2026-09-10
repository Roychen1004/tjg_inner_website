"""薪資計算（D57）

輸入一張 PayrollRecord（會計師填的出勤數字）＋一組法規參數，
輸出應發、應扣、實發，以及**每一行的算式**。

為什麼要輸出算式而不只是金額：
    會計師現在是拿計算機對打卡表，她要能驗算。只給一個「實發 32,148」
    的數字，她沒辦法判斷是不是算錯了，最後還是會自己再算一次——
    那這個系統就只是個比較貴的紙。
    所以每一行都長成「平日加班(前2小時)　10.5 小時 × 196 × 1.34 ＝ 2,758」，
    跟她原本在 Excel 裡看到的一樣。

金額一律 Decimal（鐵律 1），每一行四捨五入到元之後再加總——
先加總再四捨五入會跟她手算的結果差幾塊錢，而那幾塊錢會花掉一個下午。
"""
from decimal import ROUND_HALF_UP, Decimal

from main.apps.payroll.services.workday_service import INSURANCE_MONTH_DAYS
from main.utils.choices import PayrollLineKind

CENT = Decimal("0.01")
ONE = Decimal("1")


def money(value) -> Decimal:
    """四捨五入到元。薪資單上不會出現 0.5 元。"""
    return Decimal(value).quantize(ONE, rounding=ROUND_HALF_UP)


HALF = Decimal("0.5")


def round_half_hour(value) -> Decimal:
    """時數一律取到 0.5 小時。

    打卡表上的加班本來就是以半小時為單位在看的（8:00–17:30 那半小時就是
    這樣來的）。允許 0.1 小時只會讓人在「6 分鐘」上爭執，而那 6 分鐘
    不會有人真的去記。
    """
    return (Decimal(value) / HALF).quantize(ONE, rounding=ROUND_HALF_UP) * HALF


def _num(value) -> str:
    """數字轉成人看的字串：10.50 → 10.5、196.00 → 196、29500 → 29,500"""
    d = Decimal(value)
    if d == d.to_integral_value():
        return f"{int(d):,}"
    return f"{d.normalize():,f}"


def _rate(value) -> str:
    """百分比：12.500 → 12.5%"""
    return f"{_num(value)}%"


class _Detail:
    """一張薪資單的算式明細。加一行就記一筆，順便累加小計。"""

    def __init__(self):
        self.rows = []
        self.earning = Decimal("0")
        self.deduction = Decimal("0")
        self.employer = Decimal("0")

    def add(self, section, label, formula, amount, *, always=False):
        amount = money(amount)
        # 0 元的項目不列出來——薪資單上一排「加班 0」只是噪音。
        # always=True 的是無論如何都要看到的（正常工時、勞健保）
        if amount == 0 and not always:
            return
        self.rows.append({
            "section": section,
            "label": label,
            "formula": formula,
            "amount": str(amount),
        })
        if section == "earning":
            self.earning += amount
        elif section == "deduction":
            self.deduction += amount
        else:
            self.employer += amount


def _ot_row(detail, label, hours, wage, rate):
    if not hours:
        return
    detail.add(
        "earning", label,
        f"{_num(hours)} 小時 × {_num(wage)} × {_num(rate)}",
        Decimal(hours) * Decimal(wage) * Decimal(rate),
    )


def calculate(record, policy=None, profile=None):
    """算一張薪資單。回傳可以直接存進 PayrollRecord 的 dict。

    不寫入資料庫——呼叫端決定要不要存（試算與存檔用同一條路徑，
    才不會出現「畫面上試算是這個數、存下去變另一個數」）。
    """
    from main.apps.payroll.models import PayrollPolicy, SalaryProfile

    policy = policy or PayrollPolicy.get_active()
    if profile is None:
        profile = SalaryProfile.objects.filter(user=record.user).first()

    # 本月覆寫 > 員工設定 > 法規預設。三層都留著是因為「這個月特別」
    # 很常見，而為了一個月去改設定檔，下個月一定忘記改回來。
    wage = record.hourly_wage
    if wage is None:
        wage = profile.effective_hourly_wage(policy) if profile else policy.min_hourly_wage
    insured = record.insured_salary
    if insured is None:
        insured = profile.insured_salary if profile else Decimal("0")
    dependents = record.dependents
    if dependents is None:
        dependents = profile.dependents if profile else 0

    d = _Detail()

    # ── 應發 ───────────────────────────────────────────────────────
    d.add(
        "earning", "正常工時",
        f"{_num(record.normal_hours)} 小時 × {_num(wage)}",
        Decimal(record.normal_hours) * Decimal(wage),
        always=True,
    )
    _ot_row(d, f"平日加班（前 {_num(policy.ot_weekday_1_hours)} 小時）",
            record.ot_weekday_1_hours, wage, policy.ot_weekday_1_rate)
    _ot_row(d, "平日加班（後段）",
            record.ot_weekday_2_hours, wage, policy.ot_weekday_2_rate)
    _ot_row(d, f"休息日加班（前 {_num(policy.ot_restday_1_hours)} 小時）",
            record.ot_restday_1_hours, wage, policy.ot_restday_1_rate)
    _ot_row(d, "休息日加班（第 3–8 小時）",
            record.ot_restday_2_hours, wage, policy.ot_restday_2_rate)
    _ot_row(d, "休息日加班（超過 8 小時）",
            record.ot_restday_3_hours, wage, policy.ot_restday_3_rate)
    _ot_row(d, "國定假日出勤",
            record.holiday_hours, wage, policy.holiday_rate)

    for line in record.lines.all():
        if line.kind == PayrollLineKind.EARNING:
            d.add("earning", line.label, line.note or "手動加項", line.amount, always=True)

    gross = d.earning

    # ── 應扣 ───────────────────────────────────────────────────────
    # 請假與遲到早退放在應扣（跟原本的薪資單版面一致），但福利金的
    # 計算基礎是上面的應發總額——老闆定的規則是「未扣除前的總薪資 × 1%」
    if record.unpaid_leave_hours:
        d.add(
            "deduction", "請假（無薪）",
            f"{_num(record.unpaid_leave_hours)} 小時 × {_num(wage)}",
            Decimal(record.unpaid_leave_hours) * Decimal(wage),
        )
    late_total = int(record.late_minutes) + int(record.early_leave_minutes)
    if late_total:
        parts = []
        if record.late_minutes:
            parts.append(f"遲到 {record.late_minutes} 分")
        if record.early_leave_minutes:
            parts.append(f"早退 {record.early_leave_minutes} 分")
        d.add(
            "deduction", "遲到早退",
            f"（{'＋'.join(parts)}）÷ 60 × {_num(wage)}",
            Decimal(late_total) / Decimal("60") * Decimal(wage),
        )

    # 勞保按日計，分母固定 30（不分大小月）。整月就是 30/30，不必贅述
    days = int(record.insured_days)
    day_ratio = Decimal(days) / Decimal(INSURANCE_MONTH_DAYS)
    partial = days != INSURANCE_MONTH_DAYS
    day_text = f" ÷ {INSURANCE_MONTH_DAYS} × {days} 天" if partial else ""

    labor = (Decimal(insured) * Decimal(policy.labor_insurance_rate) / Decimal("100")
             * Decimal(policy.labor_insurance_employee_share) / Decimal("100") * day_ratio)
    d.add(
        "deduction", "勞保自付（含就保）",
        f"{_num(insured)}{day_text} × {_rate(policy.labor_insurance_rate)}"
        f" × {_rate(policy.labor_insurance_employee_share)}",
        labor, always=True,
    )

    # 健保**不按日拆**——整月計收，由「當月最後一天」的投保單位負擔。
    # 月中離職的人這個月由下一個單位收，公司不扣（charge_health_insurance=False）
    heads = 1 + min(int(dependents), int(policy.health_max_dependents))
    health_one = (Decimal(insured) * Decimal(policy.health_insurance_rate) / Decimal("100")
                  * Decimal(policy.health_insurance_employee_share) / Decimal("100"))
    if record.charge_health_insurance:
        # 健保是「每一口」各算一份再乘人數，不是總額乘人數——
        # 先四捨五入到元再乘，跟健保署的對照表才對得起來
        d.add(
            "deduction", "健保自付",
            f"{_num(insured)} × {_rate(policy.health_insurance_rate)}"
            f" × {_rate(policy.health_insurance_employee_share)}"
            + (f" × {heads} 口（本人＋眷屬 {min(int(dependents), int(policy.health_max_dependents))}）"
               if heads > 1 else ""),
            money(health_one) * heads, always=True,
        )
    else:
        d.add(
            "deduction", "健保自付",
            "本月不計收（月中離職，健保整月由下一個投保單位負擔）",
            Decimal("0"), always=True,
        )

    if profile and profile.voluntary_pension_rate:
        d.add(
            "deduction", "勞退自願提繳",
            f"{_num(insured)}{day_text} × {_rate(profile.voluntary_pension_rate)}",
            Decimal(insured) * Decimal(profile.voluntary_pension_rate) / Decimal("100") * day_ratio,
        )

    if policy.welfare_fund_rate:
        d.add(
            "deduction", "員工福利金",
            f"應發總額 {_num(money(gross))} × {_rate(policy.welfare_fund_rate)}",
            gross * Decimal(policy.welfare_fund_rate) / Decimal("100"),
            always=True,
        )

    for line in record.lines.all():
        if line.kind == PayrollLineKind.DEDUCTION:
            d.add("deduction", line.label, line.note or "手動扣項", line.amount, always=True)

    # ── 雇主另外負擔（不從薪水扣，只是讓人事成本看得見）────────────
    if policy.pension_employer_rate:
        d.add(
            "employer", "勞退雇主提繳",
            f"{_num(insured)}{day_text} × {_rate(policy.pension_employer_rate)}",
            Decimal(insured) * Decimal(policy.pension_employer_rate) / Decimal("100") * day_ratio,
        )
    # 雇主負擔的勞健保也列出來——「請一個人要花多少」不只是他領到的數字
    employer_labor = (Decimal(insured) * Decimal(policy.labor_insurance_rate) / Decimal("100")
                      * Decimal(policy.labor_insurance_employer_share) / Decimal("100") * day_ratio)
    d.add(
        "employer", "勞保雇主負擔",
        f"{_num(insured)}{day_text} × {_rate(policy.labor_insurance_rate)}"
        f" × {_rate(policy.labor_insurance_employer_share)}",
        employer_labor,
    )
    if record.charge_health_insurance:
        employer_health = (Decimal(insured) * Decimal(policy.health_insurance_rate) / Decimal("100")
                           * Decimal(policy.health_insurance_employer_share) / Decimal("100")
                           * Decimal(policy.health_employer_head_factor))
        d.add(
            "employer", "健保雇主負擔",
            f"{_num(insured)} × {_rate(policy.health_insurance_rate)}"
            f" × {_rate(policy.health_insurance_employer_share)}"
            f" × {_num(policy.health_employer_head_factor)}（平均眷口數）",
            employer_health,
        )

    net = d.earning - d.deduction

    return {
        "gross": money(d.earning),
        "deduction": money(d.deduction),
        "net": money(net),
        "employer_cost": money(d.employer),
        "detail": d.rows,
        "warnings": _warnings(record, policy, wage, net, gross=gross, insured=insured),
    }


def required_grade(monthly_wage):
    """依月薪資總額，對照分級表應該申報哪一級。

    勞保條例規定投保薪資要按**實際月薪資總額**申報，高報低報都違法。
    分級表的每一級是一個上限：薪資落在哪一級的範圍，就申報那一級；
    超過最高級以最高級計。
    """
    from main.apps.payroll.models import InsuranceGrade

    amounts = list(
        InsuranceGrade.objects.filter(is_active=True)
        .order_by("amount").values_list("amount", flat=True)
    )
    if not amounts:
        return None
    for amount in amounts:
        if Decimal(monthly_wage) <= Decimal(amount):
            return Decimal(amount)
    return Decimal(amounts[-1])


def _warnings(record, policy, wage, net, gross=None, insured=None):
    """算得出來、但可能違法或填錯的地方。只提醒不阻擋——

    擋下來的話，遇到真的有特殊狀況的那個月，會計師就只能繞過系統用
    Excel 算，那比警示還危險。
    """
    out = []

    if Decimal(wage) < Decimal(policy.min_hourly_wage):
        out.append(
            f"時薪 {_num(wage)} 低於法定最低時薪 {_num(policy.min_hourly_wage)}"
        )

    # §32：延長工時一個月不得超過 46 小時。休息日出勤時數要計入
    ot_total = (
        Decimal(record.ot_weekday_1_hours) + Decimal(record.ot_weekday_2_hours)
        + Decimal(record.ot_restday_1_hours) + Decimal(record.ot_restday_2_hours)
        + Decimal(record.ot_restday_3_hours)
    )
    if policy.monthly_ot_hours_cap and ot_total > Decimal(policy.monthly_ot_hours_cap):
        out.append(
            f"加班合計 {_num(ot_total)} 小時，超過勞基法 §32 的每月上限 "
            f"{_num(policy.monthly_ot_hours_cap)} 小時"
        )

    if net < 0:
        out.append("實發金額是負數——請檢查扣項是不是填多了")

    # 投保級距要跟著實際薪資走。低報省保費、高報衝退休金，兩種都違法，
    # 而且是查到就罰的那種——所以這裡一定要講出來。
    #
    # ⚠️ 只在**整月在職**時檢查：到職／離職不滿一個月的人，這個月實領本來
    #    就比平常少，拿它去比級距會一律誤判成「高報」，而投保薪資看的是
    #    正常月份的薪資總額，不是這個月領多少
    full_month = int(record.insured_days) >= INSURANCE_MONTH_DAYS
    if gross is not None and insured is not None and full_month:
        should = required_grade(gross)
        if should is not None and Decimal(insured) != should:
            direction = "低報" if Decimal(insured) < should else "高報"
            out.append(
                f"投保級距可能{direction}：這個月應發 {_num(money(gross))}，"
                f"對照分級表應申報 {_num(should)}，目前申報 {_num(insured)}。"
                f"投保薪資要按實際月薪資總額申報，高報低報都違法——"
                f"確定要調整的話記得也向勞保局申報"
            )

    return out
