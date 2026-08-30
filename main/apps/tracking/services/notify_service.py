"""
流程單元相關的站內通知

五種事件：
  1. 被指派 → 通知負責人「你收到任務」
  2. 單元逾期 → 通知負責人與經理（每日排程掃描，dedup 防轟炸）
  3. 單元完成觸發期別可請款 → 通知經理與會計（billing 那邊發，這裡只發完成通知）
  4. 工作分配（D41）→ 通知被分到工段分量的員工
  5. 分配回報完成（D41）→ 通知單元的主要負責人（附該工段彙總進度）
"""
from main.apps.core.models import Notification, Role, User
from main.utils.choices import NotificationCategory


def _users_with_role(*roles):
    return list(User.objects.filter(is_active=True, groups__name__in=roles).distinct())


def assigned(unit, actor):
    """指派負責人時通知對方。自己指派給自己就不用通知了。"""
    if not unit.assignee_id or unit.assignee_id == getattr(actor, "pk", None):
        return
    Notification.send(
        [unit.assignee],
        f"你收到任務：{unit.flow_display_name}",
        body=(
            f"專案「{unit.project.name}」的「{unit.flow_display_name}」指派給你。"
            + (f"預計 {unit.plan_start} 開始、{unit.plan_end} 完成。" if unit.plan_end else "")
        ),
        link_url=f"/mywork?unit={unit.pk}",
        category=NotificationCategory.TRACKING,
        dedup_key=f"flow:assigned:{unit.pk}:{unit.assignee_id}",
        dedup_days=1,
    )


def flow_completed(unit, actor):
    """單元完成 → 通知經理（誰完成了什麼）。"""
    recipients = [
        u for u in _users_with_role(Role.OWNER)
        if u.pk != getattr(actor, "pk", None)
    ]
    Notification.send(
        recipients,
        f"{unit.project.name}：「{unit.flow_display_name}」已完成",
        body=f"由 {getattr(actor, 'name', '系統')} 回報完成。",
        link_url=f"/projects?open={unit.project_id}",
        category=NotificationCategory.TRACKING,
        dedup_key=f"flow:done:{unit.pk}",
        dedup_days=1,
    )


def _qty_text(qty, uom):
    return f"{qty:g} {uom}".strip() if qty is not None else ""


def task_assigned(assignment, actor):
    """工作分配（D41）→ 通知被分到的員工。自己分給自己不通知。"""
    if not assignment.assignee_id or assignment.assignee_id == getattr(actor, "pk", None):
        return
    task = assignment.task
    unit = task.unit
    Notification.send(
        [assignment.assignee],
        f"你收到工作：{task.name} {assignment.status} "
        f"{_qty_text(assignment.qty_assigned, task.unit_of_measure)}",
        body=(
            f"專案「{unit.project.name}」·{unit.flow_display_name}："
            f"「{task.name}」的「{assignment.status}」分了 "
            f"{_qty_text(assignment.qty_assigned, task.unit_of_measure)} 給你。"
            "做多少回報多少，全部做完會通知主要負責人。"
            # D49：分配時的叮嚀直接進通知——被分到的人第一眼就看到
            + (f"\n📌 注意事項：{assignment.note}" if assignment.note else "")
        ),
        link_url=f"/mywork?unit={unit.pk}",
        category=NotificationCategory.TRACKING,
        dedup_key=f"task:assigned:{assignment.pk}",
        dedup_days=1,
    )


def task_progress(assignment, actor):
    """分配回報完成（D41）→ 通知單元主要負責人，附該工段的彙總進度。"""
    task = assignment.task
    unit = task.unit
    if not unit.assignee_id or unit.assignee_id == getattr(actor, "pk", None):
        return
    stage_done = sum(
        a.qty_done for a in task.assignments.all() if a.status == assignment.status
    )
    denom = task.qty or sum(
        a.qty_assigned for a in task.assignments.all() if a.status == assignment.status
    )
    pct = round(float(stage_done / denom * 100), 1) if denom else 0.0
    Notification.send(
        [unit.assignee],
        f"{task.name}·{assignment.status}：{getattr(actor, 'name', '系統')} 回報完成",
        body=(
            f"專案「{unit.project.name}」·{unit.flow_display_name}：「{task.name}」的"
            f"「{assignment.status}」目前 {stage_done:g}/{denom:g}（{pct:g}%）。"
        ),
        link_url=f"/mywork?unit={unit.pk}",
        category=NotificationCategory.TRACKING,
        dedup_key=f"task:progress:{assignment.pk}",
        dedup_days=1,
    )


def flow_overdue(unit):
    """單元逾期 → 通知負責人與經理。scan_alerts 每日呼叫，dedup 3 天一次。"""
    recipients = _users_with_role(Role.OWNER)
    if unit.assignee_id and unit.assignee.is_active and unit.assignee not in recipients:
        recipients.append(unit.assignee)
    Notification.send(
        recipients,
        f"逾期：{unit.project.name}·{unit.flow_display_name}",
        body=f"預計 {unit.plan_end} 完成，目前仍是「{unit.get_state_display()}」。",
        link_url=f"/mywork?unit={unit.pk}",
        category=NotificationCategory.ALERT,
        dedup_key=f"flow:overdue:{unit.pk}",
        dedup_days=3,
    )
