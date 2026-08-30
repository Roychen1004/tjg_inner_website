"""
金流軌的自動觸發（docs/鋼構專案流程.md 6.1）

期別掛了「觸發流程」，該流程完成 → 期別自動 未到→可請款，
寫入不可竄改的歷程，並通知經理與會計「可以開單了」。

只動「未到」的期別；已經可請款／已請款的不重複觸發。

D46 起**反向也同步**（老闆指示）：觸發流程被重啟、或連結被取消時，
還停在「可請款」的期別自動退回「未到」（留歷程、發通知）。
已請款／已收款的**不會**被自動改——單開出去了，撤不撤是財務的決定；
這種情況改發警示通知請人工處理。
"""
import logging

from django.utils import timezone

from main.apps.billing.models import BillingMilestone, MilestoneLog
from main.utils.choices import MilestoneState, NotificationCategory

logger = logging.getLogger("tjg")


def auto_claimable(unit, actor=None):
    """unit（流程單元）完成時呼叫。回傳轉為可請款的期別數。"""
    milestones = BillingMilestone.objects.filter(
        trigger_unit=unit, state=MilestoneState.PENDING
    ).select_related("project")

    count = 0
    for milestone in milestones:
        from_state = milestone.state
        milestone.state = MilestoneState.CLAIMABLE
        milestone.claimable_at = timezone.now()
        milestone.save(update_fields=["state", "claimable_at", "updated_at"])
        MilestoneLog.objects.create(
            milestone=milestone, from_state=from_state, to_state=MilestoneState.CLAIMABLE,
            reason=f"觸發流程「{unit.flow_display_name}」完成，系統自動轉可請款",
            amount_snapshot=milestone.amount, changed_by=actor,
        )
        _notify(milestone, unit)
        count += 1
        logger.info("期別 %s 自動轉可請款（觸發：%s）", milestone.pk, unit.flow_display_name)
    return count


def revert_claimable(milestone, actor=None, reason=""):
    """把一筆還停在「可請款」的期別退回「未到」（單一筆）。回傳是否有退。

    只動 CLAIMABLE：已請款／已收款的錢不能被進度或設定的副作用改掉。
    """
    if milestone.state != MilestoneState.CLAIMABLE:
        return False
    milestone.state = MilestoneState.PENDING
    milestone.claimable_at = None
    milestone.save(update_fields=["state", "claimable_at", "updated_at"])
    MilestoneLog.objects.create(
        milestone=milestone, from_state=MilestoneState.CLAIMABLE,
        to_state=MilestoneState.PENDING,
        reason=reason or "系統自動退回未到",
        amount_snapshot=milestone.amount, changed_by=actor,
    )
    _notify_reverted(milestone, reason)
    logger.info("期別 %s 退回未到（%s）", milestone.pk, reason)
    return True


def on_trigger_reopened(unit, actor=None):
    """觸發流程被重啟（已完成→進行中）時呼叫（D46）。

    可請款的期別退回未到；已請款／已收款的改發警示請人工決定。
    回傳退回的期別數。
    """
    count = 0
    for milestone in BillingMilestone.objects.filter(trigger_unit=unit).select_related("project"):
        if milestone.state == MilestoneState.CLAIMABLE:
            revert_claimable(
                milestone, actor,
                f"觸發流程「{unit.flow_display_name}」重啟，系統自動退回未到",
            )
            count += 1
        elif milestone.state in (MilestoneState.INVOICED, MilestoneState.RECEIVED):
            _notify_conflict(milestone, unit)
    return count


def _notify_reverted(milestone, reason):
    from main.apps.core.models import Notification, Role, User

    recipients = list(
        User.objects.filter(
            is_active=True, groups__name__in=[Role.OWNER, Role.FINANCE]
        ).distinct()
    )
    if milestone.accountant and milestone.accountant.is_active and milestone.accountant not in recipients:
        recipients.append(milestone.accountant)
    Notification.send(
        recipients,
        f"期別退回未到：{milestone.project.name}·{milestone.label}",
        body=f"{reason}。這期先不要開單。",
        link_url=f"/finance?milestone={milestone.pk}",
        category=NotificationCategory.BILLING,
        dedup_key=f"milestone:reverted:{milestone.pk}",
        dedup_days=0,
    )


def _notify_conflict(milestone, unit):
    """觸發流程重啟但期別已請款——系統不能自動撤單，請人工決定。"""
    from main.apps.core.models import Notification, Role, User

    recipients = list(
        User.objects.filter(
            is_active=True, groups__name__in=[Role.OWNER, Role.FINANCE]
        ).distinct()
    )
    Notification.send(
        recipients,
        f"⚠️ 觸發流程重啟，但「{milestone.label}」已請款",
        body=(
            f"{milestone.project.name}：「{unit.flow_display_name}」被重啟，"
            f"但這期（{milestone.amount:,.0f} 元）已經請款。"
            "要不要撤單請到 金流 → 應收 人工處理——系統不會自動改已請款的錢。"
        ),
        link_url=f"/finance?milestone={milestone.pk}",
        category=NotificationCategory.BILLING,
        dedup_key=f"milestone:conflict:{milestone.pk}",
        dedup_days=1,
    )


def _notify(milestone, unit):
    from main.apps.core.models import Notification, Role, User

    recipients = list(
        User.objects.filter(
            is_active=True, groups__name__in=[Role.OWNER, Role.FINANCE]
        ).distinct()
    )
    # D45：期別指定了負責收款的會計師，一定通知到（就算他不在上面的角色裡）
    if milestone.accountant and milestone.accountant.is_active and milestone.accountant not in recipients:
        recipients.append(milestone.accountant)
    assigned = (
        f"由 {milestone.accountant.name} 負責收款（在他的「我的任務」也看得到）。"
        if milestone.accountant
        else ""
    )
    Notification.send(
        recipients,
        f"可以請款了：{milestone.project.name}·{milestone.label}",
        body=(
            f"「{unit.flow_display_name}」已完成，本期 {milestone.amount:,.0f} 元轉為可請款。"
            f"{assigned}請到 金流 → 應收 開單。"
        ),
        link_url=f"/finance?milestone={milestone.pk}",
        category=NotificationCategory.BILLING,
        dedup_key=f"milestone:claimable:{milestone.pk}",
        dedup_days=3,
    )
