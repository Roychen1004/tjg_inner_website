"""D51 資料遷移：既有專案的顯示編號依目前順序回填（位置制）。

一個階段一組、從 1 起算；「不適用」的不佔號、留空（顯示時退回目錄代號）。
"""
from django.db import migrations


def forwards(apps, schema_editor):
    Project = apps.get_model("projects", "Project")
    FlowUnit = apps.get_model("tracking", "FlowUnit")

    for project in Project.objects.all():
        units = (
            FlowUnit.objects.filter(project=project)
            .exclude(state="na")
            .select_related("flow_item__stage", "stage")
            .order_by("seq", "id")
        )
        counters = {}
        for unit in units:
            stage = unit.stage or (unit.flow_item.stage if unit.flow_item else None)
            seq = stage.seq if stage else 0
            counters[seq] = counters.get(seq, 0) + 1
            code = f"{seq}.{counters[seq]}"
            if unit.code != code:
                FlowUnit.objects.filter(pk=unit.pk).update(code=code)


def backwards(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("tracking", "0010_flowunit_code_historicalflowunit_code"),
    ]

    operations = [migrations.RunPython(forwards, backwards)]
