"""薪資的參照資料（D57）

三份種子：法規參數一組、投保薪資分級表 11 級、2026 年國定假日。

為什麼放在 migration 而不是 seed 指令：這三份東西沒有它系統就算不出薪水
（分級表空的話投保薪資無從選起），屬於「表建好就該在」的資料，
不是示範資料。冪等——已經有的不動，會計師改過的值不會被蓋掉。
"""
import datetime as dt
from decimal import Decimal

from django.db import migrations

# 115 年（2026）勞工保險投保薪資分級表：11 級
INSURANCE_GRADES = [
    (1, "29500"), (2, "30300"), (3, "31800"), (4, "33300"),
    (5, "34800"), (6, "36300"), (7, "38200"), (8, "40100"),
    (9, "42000"), (10, "43900"), (11, "45800"),
]

# 115 年（2026）政府行政機關辦公日曆表——**只列落在週一至週五的假日**，
# 因為只有這些會讓「應上班天數」變少。週末的假日不必登記。
# 2025 年下半年起已取消補班，所以 2026 年沒有補班日。
HOLIDAYS_2026 = [
    ("2026-01-01", "元旦"),
    ("2026-02-16", "除夕"),
    ("2026-02-17", "春節初一"),
    ("2026-02-18", "春節初二"),
    ("2026-02-19", "春節初三"),
    ("2026-02-20", "春節（2/15 週日補假）"),
    ("2026-02-27", "和平紀念日（2/28 週六補假）"),
    ("2026-04-03", "兒童節（4/4 週六補假）"),
    ("2026-04-06", "清明節（4/5 週日補假）"),
    ("2026-05-01", "勞動節"),
    ("2026-06-19", "端午節"),
    ("2026-09-25", "中秋節"),
    ("2026-09-28", "教師節"),
    ("2026-10-09", "國慶日（10/10 週六補假）"),
    ("2026-10-26", "臺灣光復節（10/25 週日補假）"),
    ("2026-12-25", "行憲紀念日"),
]


def seed(apps, schema_editor):
    Policy = apps.get_model("payroll", "PayrollPolicy")
    Grade = apps.get_model("payroll", "InsuranceGrade")
    Holiday = apps.get_model("payroll", "Holiday")

    # 欄位的 default 已經是現行法規，直接建一筆就好
    if not Policy.objects.exists():
        Policy.objects.create(
            name="115 年（2026）現行法規",
            effective_from=dt.date(2026, 1, 1),
        )

    for level, amount in INSURANCE_GRADES:
        Grade.objects.get_or_create(level=level, defaults={"amount": Decimal(amount)})

    for iso, name in HOLIDAYS_2026:
        Holiday.objects.get_or_create(
            date=dt.date.fromisoformat(iso), defaults={"name": name},
        )


def unseed(apps, schema_editor):
    """只收走種子建的假日與級距；參數那筆留著（可能被改過）"""
    apps.get_model("payroll", "Holiday").objects.filter(
        date__year=2026,
    ).delete()
    apps.get_model("payroll", "InsuranceGrade").objects.filter(
        level__lte=11,
    ).delete()


class Migration(migrations.Migration):
    dependencies = [("payroll", "0001_initial")]
    operations = [migrations.RunPython(seed, unseed)]
