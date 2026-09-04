"""預設行政類別（D53）——繳費、打掃、其他

冪等：依名稱 get_or_create，已存在（含被改過顏色的）不動。
"""
from django.db import migrations

DEFAULTS = [
    ("繳費", "#f59e0b"),
    ("打掃", "#10b981"),
    ("其他", "#64748b"),
]


def seed(apps, schema_editor):
    AffairCategory = apps.get_model("affairs", "AffairCategory")
    for name, color in DEFAULTS:
        AffairCategory.objects.get_or_create(name=name, defaults={"color": color})


class Migration(migrations.Migration):
    dependencies = [
        ("affairs", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(seed, migrations.RunPython.noop),
    ]
