"""行政事項的站內通知（D53）

三種事件：
  1. 被指派臨時事項 → 通知被指派的人（會出現在你的「我的任務」）
  2. 被指派例行規則 → 通知一次（不是每一次發生都轟炸）
  3. 事項完成 → 通知經理與系統管理員（誰、何時、完成了什麼）——
     員工勾完成不需要主管確認，但主管要看得到
"""
from django.db.models import Q

from main.apps.core.models import Notification, Role, User
from main.utils.choices import NotificationCategory


def _managers():
    return list(
        User.objects.filter(is_active=True)
        .filter(Q(groups__name=Role.OWNER) | Q(is_superuser=True))
        .distinct()
    )


def task_assigned(task, actor, users):
    """臨時事項指派 → 通知新被指派的人。自己指派自己不通知。"""
    recipients = [u for u in users if u.pk != getattr(actor, "pk", None)]
    if not recipients:
        return
    Notification.send(
        recipients,
        f"你收到行政事項：{task.title}",
        body=(
            f"{task.date}·{task.category.name}"
            + (f"\n📌 {task.note}" if task.note else "")
        ),
        link_url="/mywork",
        category=NotificationCategory.AFFAIR,
        dedup_key=f"affair:assigned:{task.pk}",
        dedup_days=1,
    )


def rule_assigned(rule, actor, users):
    """例行規則指派 → 通知一次，之後每一次自動出現在「我的任務」。"""
    recipients = [u for u in users if u.pk != getattr(actor, "pk", None)]
    if not recipients:
        return
    Notification.send(
        recipients,
        f"你收到例行行政事項：{rule.title}",
        body=(
            f"{rule.freq_text}·{rule.category.name}，"
            "每一次都會出現在你的「我的任務」裡。"
            + (f"\n📌 {rule.note}" if rule.note else "")
        ),
        link_url="/mywork",
        category=NotificationCategory.AFFAIR,
        dedup_key=f"affair:rule-assigned:{rule.pk}",
        dedup_days=1,
    )


def task_completed(task, actor):
    """事項完成 → 通知經理與系統管理員。"""
    recipients = [u for u in _managers() if u.pk != getattr(actor, "pk", None)]
    Notification.send(
        recipients,
        f"行政事項完成：{task.title}",
        body=f"{getattr(actor, 'name', '系統')} 已完成（{task.date}·{task.category.name}）。",
        link_url=f"/affairs?date={task.date.isoformat()}",
        category=NotificationCategory.AFFAIR,
        dedup_key=f"affair:done:{task.pk}",
        dedup_days=1,
    )
