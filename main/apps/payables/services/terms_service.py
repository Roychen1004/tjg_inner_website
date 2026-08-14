"""
付款條件 → 日期

收款與付款共用同一套算法。一邊算對、另一邊算錯，是最容易發生的事，
所以只寫一次。

⚠️ **月結是這裡唯一真正容易搞錯的地方。**

    「月結 60 天」＝ 計價當月的**月底**再加 60 天
    1/15 請款 → 1/31 結帳 → 4/1 收款

    而不是 1/15 + 60 = 3/16。

差了半個月，而且錯的方向是「以為錢比較早進來」——
現金流表看起來安全，實際上那一週會缺錢。
"""
import calendar
from datetime import date, timedelta

from main.utils.choices import PaymentTermType

#: 從「可以請款」到「單子真的開出去」的作業天數。
#: 不是猜的，是給還沒開單的那一級一個保守的落點——
#: 假設今天就開出去，等於高估了現金流的速度。
INVOICE_LEAD_DAYS = 3


def month_end(day: date) -> date:
    return day.replace(day=calendar.monthrange(day.year, day.month)[1])


def due_date(base: date | None, term_type: str, term_days: int) -> date | None:
    """由基準日與付款條件推算到期日。基準日沒有就回 None——

    推不出來就說推不出來，**不要假裝知道**。
    """
    if base is None:
        return None
    days = int(term_days or 0)
    if term_type == PaymentTermType.MONTH_END:
        return month_end(base) + timedelta(days=days)
    # FROM_INVOICE 與 FROM_ACCEPTANCE 的差別在「基準日是哪一天」，
    # 不在算法。基準日由呼叫端決定，這裡一律直接加
    return base + timedelta(days=days)


def describe(term_type: str, term_days: int) -> str:
    """給人看的付款條件。表單旁邊要放這句，否則沒人知道月結是怎麼算的。"""
    labels = dict(PaymentTermType.choices)
    name = labels.get(term_type, term_type)
    if term_type == PaymentTermType.MONTH_END:
        return f"{name} {term_days} 天（計價當月月底起算）"
    return f"{name} {term_days} 天"


def example(term_type: str, term_days: int, base: date | None = None) -> str:
    """用一個實際日期示範。抽象的規則說明沒人讀得懂，一個例子就懂了。"""
    base = base or date(date.today().year, 1, 15)
    result = due_date(base, term_type, term_days)
    if result is None:
        return ""
    return f"例：{base:%-m/%-d} 計價 → {result:%-m/%-d} 付款"
