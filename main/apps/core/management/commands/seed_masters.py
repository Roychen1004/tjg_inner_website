"""
主檔種子：階段模板與階段

冪等——重跑不會產生重複資料，已存在就更新。
站數是 2026-08-13 簡化後的版本：進度由辦公室事後補登，
只留「補登的人真的會去按」的站。要加站直接在 Django Admin 加。
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from main.apps.masters.models import Stage, StageTemplate
from main.utils.choices import TemplateAppliesTo

TEMPLATES = [
    {
        "code": "main",
        "name": "專案主線",
        "applies_to": TemplateAppliesTo.PROJECT_MAIN,
        "stages": [
            # (code, name, color, stall_days)
            ("prep", "準備中", "#6366f1", None),      # 接案、設計、報價、備料都算
            ("build", "施工中", "#f59e0b", None),
            ("verify", "驗收中", "#10b981", 30),
            ("closed", "結案", "#64748b", None),
        ],
    },
    {
        "code": "steel",
        "name": "鋼構構件批次",
        "applies_to": TemplateAppliesTo.STEEL_BATCH,
        "stages": [
            ("wait", "待料", "#94a3b8", 14),
            ("fab", "加工", "#86b6ef", 21),
            ("ship", "已出貨", "#0ea5e9", 14),
            ("install", "安裝中", "#f59e0b", 30),
            ("done", "完成", "#10b981", None),
        ],
    },
    {
        "code": "civil",
        "name": "土建工項",
        "applies_to": TemplateAppliesTo.CIVIL_WORK_ITEM,
        "stages": [
            ("pending", "未開工", "#94a3b8", None),
            ("build", "施工中", "#f59e0b", None),   # 進度看完成百分比，站不用切太細
            ("done", "完成", "#10b981", None),
        ],
    },
]


class Command(BaseCommand):
    help = "建立階段模板主檔（冪等）"

    @transaction.atomic
    def handle(self, *args, **options):
        for spec in TEMPLATES:
            template, created = StageTemplate.objects.update_or_create(
                code=spec["code"],
                defaults={
                    "name": spec["name"],
                    "applies_to": spec["applies_to"],
                    "is_default": True,
                    "is_active": True,
                },
            )
            for seq, (code, name, color, stall) in enumerate(spec["stages"], start=1):
                Stage.objects.update_or_create(
                    template=template, code=code,
                    defaults={
                        "seq": seq, "name": name, "color": color,
                        "stall_days": stall, "is_active": True,
                    },
                )
            # 不在名單裡的舊站停用（不刪——歷程還指著它們）
            keep = [c for c, *_ in spec["stages"]]
            template.stages.exclude(code__in=keep).update(is_active=False)

            state = "建立" if created else "更新"
            self.stdout.write(f"  {state} {template.name}（{len(spec['stages'])} 站）")

        self.stdout.write(self.style.SUCCESS("主檔種子完成"))
