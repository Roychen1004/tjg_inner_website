"""D49 資料遷移：把既有流程單元的順序與大階段從目錄抄到單元自己身上。

seq＝目錄 seq×10（留插入空隙）、stage＝目錄的大階段。
name 留空（顯示時回頭取目錄名）——只有自訂流程才會有自己的名字。
"""
from django.db import migrations


def forwards(apps, schema_editor):
    FlowUnit = apps.get_model("tracking", "FlowUnit")
    for unit in FlowUnit.objects.filter(seq__isnull=True).select_related("flow_item"):
        if unit.flow_item_id is None:
            continue
        unit.seq = unit.flow_item.seq * 10
        unit.stage_id = unit.flow_item.stage_id
        unit.save(update_fields=["seq", "stage"])


def backwards(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("tracking", "0008_alter_flowunit_options_flowtaskassignment_note_and_more"),
    ]

    operations = [migrations.RunPython(forwards, backwards)]
