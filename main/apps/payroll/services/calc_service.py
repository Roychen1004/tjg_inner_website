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
from main.utils.choices import PayrollLineKind, PayType

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
    """數字轉成人看的字串：10.50 → 10.5、196.00 → 196、29500 → 29,500

    最多兩位小數。算式是拿來給人對計算機的——出現
    `145.8333333333333333333333333` 就等於沒有算式。
    """
    d = Decimal(value)
    if d == d.to_integral_value():
        return f"{int(d):,}"
    d = d.quantize(CENT, rounding=ROUND_HALF_UP)
    return f"{d.normalize():,f}" if d != d.to_integral_value() else f"{int(d):,}"


def _rate(value) -> str:
    """百分比：12.500 → 12.5%"""
    return f"{_num(value)}%"


def solve_gross_from_net(target, fixed_deductions, welfare_rate):
    """已知「實際領取」，反推「薪資總額」。

    為什麼要解方程而不是直接相加：勞保、健保、勞退自願提繳都是按**投保薪資**
    算的固定金額，加回去就好；但**員工福利金是按應發總額 × 1%**——
    總額還沒算出來，福利金就算不出來，加不回去。

        總額 − 固定扣項 − 總額 × 1% = 實領
        總額 × (1 − 1%)             = 實領 + 固定扣項
        總額                        = (實領 + 固定扣項) ÷ (1 − 1%)

    最後那個迴圈是在補四捨五入的零頭：福利金會四捨五入到元，
    直接套公式可能差一兩塊。會計師打「實領 35,000」，薪資單上就該**剛好**
    是 35,000——差三塊錢她會找一個下午。
    """
    target = Decimal(target)
    fixed = Decimal(fixed_deductions)
    rate = Decimal(welfare_rate) / Decimal("100")
    if rate >= 1:                       # 參數被填成 100% 以上，公式無解
        return money(target + fixed)

    gross = money((target + fixed) / (Decimal("1") - rate))
    for _ in range(8):
        net = gross - fixed - money(gross * rate)
        diff = target - net
        if diff == 0:
            break
        gross += diff
    return gross


def resolve_wage(record, profile, policy):
    """這張薪資單實際採用的「平日每小時工資額」。

    三層：本月覆寫 > 員工設定 > 法規最低時薪。月薪制則是 月薪 ÷ 240。

    ★ 抽出來共用，是為了讓**畫面上顯示的時薪**與**算加班費用的時薪**
      保證是同一個數。各算各的遲早會分岔一分錢，而那一分錢會讓會計師
      對不起來。
    """
    if record.hourly_wage is not None:
        return Decimal(record.hourly_wage)

    monthly = record.monthly_salary
    is_monthly = profile is not None and profile.is_monthly
    # 本月覆寫了月薪 → 時薪也要跟著換算，否則加班費會用舊月薪算
    if monthly is not None and is_monthly:
        divisor = Decimal(policy.monthly_wage_divisor or 240)
        if divisor > 0:
            return (Decimal(monthly) / divisor).quantize(CENT, rounding=ROUND_HALF_UP)

    if profile is not None:
        return Decimal(profile.effective_hourly_wage(policy))
    return Decimal(policy.min_hourly_wage)


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
    wage = resolve_wage(record, profile, policy)
    insured = record.insured_salary
    if insured is None:
        insured = profile.insured_salary if profile else Decimal("0")
    dependents = record.dependents
    if dependents is None:
        dependents = profile.dependents if profile else 0
    pay_type = profile.pay_type if profile else PayType.HOURLY
    monthly = record.monthly_salary
    if monthly is None:
        monthly = profile.monthly_salary if profile else None

    d = _Detail()

    # ── 先算「跟應發總額無關」的扣項 ───────────────────────────────
    # 反推實領時要用到它們；順序提前不影響時薪制的結果
    days = int(record.insured_days)
    day_ratio = Decimal(days) / Decimal(INSURANCE_MONTH_DAYS)
    partial = days != INSURANCE_MONTH_DAYS
    day_text = f" ÷ {INSURANCE_MONTH_DAYS} × {days} 天" if partial else ""

    labor = money(
        Decimal(insured) * Decimal(policy.labor_insurance_rate) / Decimal("100")
        * Decimal(policy.labor_insurance_employee_share) / Decimal("100") * day_ratio
    )
    heads = 1 + min(int(dependents), int(policy.health_max_dependents))
    health_one = money(
        Decimal(insured) * Decimal(policy.health_insurance_rate) / Decimal("100")
        * Decimal(policy.health_insurance_employee_share) / Decimal("100")
    )
    health = health_one * heads if record.charge_health_insurance else Decimal("0")
    voluntary = Decimal("0")
    if profile and profile.voluntary_pension_rate:
        voluntary = money(
            Decimal(insured) * Decimal(profile.voluntary_pension_rate) / Decimal("100") * day_ratio
        )

    # ── 應發 ───────────────────────────────────────────────────────
    if pay_type == PayType.MONTHLY_GROSS:
        base = Decimal(monthly or 0) * day_ratio
        d.add(
            "earning", "月薪（薪資總額）",
            f"{_num(monthly or 0)}{day_text}" if partial else f"{_num(monthly or 0)}",
            base, always=True,
        )
    elif pay_type == PayType.MONTHLY_NET:
        # 老闆跟員工談的是「每月實拿多少」——這裡把它反推成薪資總額
        target = money(Decimal(monthly or 0) * day_ratio)
        fixed = labor + health + voluntary
        base = solve_gross_from_net(target, fixed, policy.welfare_fund_rate)
        parts = [f"實領 {_num(target)}"]
        if labor:
            parts.append(f"勞保 {_num(labor)}")
        if health:
            parts.append(f"健保 {_num(health)}")
        if voluntary:
            parts.append(f"勞退自提 {_num(voluntary)}")
        d.add(
            "earning",
            "月薪（由實領反推）" + (f"，在職 {days}/{INSURANCE_MONTH_DAYS} 天" if partial else ""),
            f"（{' ＋ '.join(parts)}）÷（1 − {_rate(policy.welfare_fund_rate)}）",
            base, always=True,
        )
    else:
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

    # 這三筆在最前面就算好了（反推實領時要用）。這裡只負責寫出算式——
    # 同一個數字算兩次遲早會分岔
    d.add(
        "deduction", "勞保自付（含就保）",
        f"{_num(insured)}{day_text} × {_rate(policy.labor_insurance_rate)}"
        f" × {_rate(policy.labor_insurance_employee_share)}",
        labor, always=True,
    )

    # 健保**不按日拆**——整月計收，由「當月最後一天」的投保單位負擔。
    # 月中離職的人這個月由下一個單位收，公司不扣（charge_health_insurance=False）
    if record.charge_health_insurance:
        # 健保是「每一口」各算一份再乘人數，不是總額乘人數——
        # 先四捨五入到元再乘，跟健保署的對照表才對得起來
        d.add(
            "deduction", "健保自付",
            f"{_num(insured)} × {_rate(policy.health_insurance_rate)}"
            f" × {_rate(policy.health_insurance_employee_share)}"
            + (f" × {heads} 口（本人＋眷屬 {min(int(dependents), int(policy.health_max_dependents))}）"
               if heads > 1 else ""),
            health, always=True,
        )
    else:
        d.add(
            "deduction", "健保自付",
            "本月不計收（月中離職，健保整月由下一個投保單位負擔）",
            Decimal("0"), always=True,
        )

    if voluntary:
        d.add(
            "deduction", "勞退自願提繳",
            f"{_num(insured)}{day_text} × {_rate(profile.voluntary_pension_rate)}",
            voluntary,
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
        "warnings": _warnings(
            record, policy, wage, net, gross=gross, insured=insured, profile=profile,
        ),
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


def missing_monthly_salary(record, profile=None):
    """選了月薪制卻還沒填金額——那個人的薪水會算成 0。

    回傳 True 時，畫面上要看得到，確認整月時要擋下來。
    """
    from main.apps.payroll.models import SalaryProfile

    if profile is None:
        profile = SalaryProfile.objects.filter(user=record.user).first()
    if profile is None or not profile.is_monthly:
        return False
    amount = record.monthly_salary if record.monthly_salary is not None else profile.monthly_salary
    return not amount


def _warnings(record, policy, wage, net, gross=None, insured=None, profile=None):
    """算得出來、但可能違法或填錯的地方。只提醒不阻擋——

    擋下來的話，遇到真的有特殊狀況的那個月，會計師就只能繞過系統用
    Excel 算，那比警示還危險。
    """
    out = []

    if missing_monthly_salary(record, profile):
        out.append(
            "選了月薪制但還沒填月薪金額——這個月會算成 0。"
            "請到「員工設定」把月薪填上"
        )

    # 月薪制不比這個：月薪 ÷ 240 本來就會低於最低「時薪」，
    # 那是換算基準不是他的工資率，拿來比只會每個月都跳一個假警示
    is_monthly = profile is not None and profile.is_monthly
    if not is_monthly and Decimal(wage) < Decimal(policy.min_hourly_wage):
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
