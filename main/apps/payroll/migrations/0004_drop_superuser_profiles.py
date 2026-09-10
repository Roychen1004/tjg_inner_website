"""系統管理員不算薪水（D57 第二輪）

`admin` 是系統維護用的身分，不是員工——第一版的「同步員工名冊」
把他一起建進去了。這裡把 superuser 的薪資設定停用（不刪除：
萬一哪天真的要發薪水給他，資料還在，重新勾啟用即可）。
"""
from django.db import migrations


def deactivate(apps, schema_editor):
    apps.get_model("payroll", "SalaryProfile").objects.filter(
        user__is_superuser=True,
    ).update(is_active=False)


def noop(apps, schema_editor):
    """不還原——把 superuser 加回薪資名冊不是「回復原狀」，是製造問題"""


class Migration(migrations.Migration):
    dependencies = [("payroll", "0003_payroll_partial_month")]
    operations = [migrations.RunPython(deactivate, noop)]
