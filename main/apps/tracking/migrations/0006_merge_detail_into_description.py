# D43（2026-08-18）：「詳細內容」併入「工作內容」。
#
# 老闆連四輪反映卡片裡「一樣的東西一直出現」——根源是兩個都在回答
# 「這一步要做什麼」的多行文字欄位（description 與 detail）各佔一個區塊。
# 畫面收斂成單一「工作內容」區塊；既有 detail 的文字搬進 description
# 後清空（資料不丟，只是不再分兩欄）。欄位本身保留（migrations 只加不改）。

from django.db import migrations


def merge_detail(apps, schema_editor):
    FlowUnit = apps.get_model("tracking", "FlowUnit")
    for unit in FlowUnit.objects.exclude(detail="").iterator():
        merged = f"{unit.description}\n\n{unit.detail}".strip() if unit.description else unit.detail
        unit.description = merged
        unit.detail = ""
        unit.save(update_fields=["description", "detail"])


class Migration(migrations.Migration):

    dependencies = [
        ("tracking", "0005_flowunit_task_statuses_and_more"),
    ]

    operations = [
        migrations.RunPython(merge_detail, migrations.RunPython.noop),
    ]
