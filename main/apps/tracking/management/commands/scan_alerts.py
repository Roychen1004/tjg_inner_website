"""
每日警示掃描（cron 08:00）

逾期的流程單元 → 通知負責人與經理。
dedup_key 三天內只發一次，不會天天轟炸同一件事。
"""
from django.core.management.base import BaseCommand

from main.apps.tracking.models import FlowUnit
from main.apps.tracking.services import notify_service
from main.utils.choices import ProjectLifecycle


class Command(BaseCommand):
    help = "掃描逾期的流程單元並發站內通知（冪等，dedup 防重）"

    def handle(self, *args, **options):
        overdue = (
            FlowUnit.objects.overdue()
            .filter(project__lifecycle=ProjectLifecycle.ACTIVE)
            .select_related("project", "flow_item", "assignee")
        )
        count = 0
        for unit in overdue:
            notify_service.flow_overdue(unit)
            count += 1
        self.stdout.write(self.style.SUCCESS(f"掃描完成：{count} 個逾期單元"))
