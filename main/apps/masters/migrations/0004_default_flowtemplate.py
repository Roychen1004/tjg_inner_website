"""D49 資料遷移：把現有的 19 項目錄歸入「標準流程」預設模板。

只回填空的 template 欄位，不動任何工作項的內容——已建案子的單元
早就抄走了內容，這裡只是給目錄一個名字。
"""
from django.db import migrations


def forwards(apps, schema_editor):
    FlowTemplate = apps.get_model("masters", "FlowTemplate")
    FlowItem = apps.get_model("masters", "FlowItem")

    if not FlowItem.objects.filter(template__isnull=True).exists():
        return
    template, _created = FlowTemplate.objects.get_or_create(
        name="標準流程", defaults={"is_default": True, "is_active": True},
    )
    FlowItem.objects.filter(template__isnull=True).update(template=template)


def backwards(apps, schema_editor):
    pass  # 只加不減：模板留著無害


class Migration(migrations.Migration):
    dependencies = [
        ("masters", "0003_flowtemplate_alter_flowitem_code_alter_flowitem_seq_and_more"),
    ]

    operations = [migrations.RunPython(forwards, backwards)]
