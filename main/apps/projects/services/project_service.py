"""
專案層的業務操作：勾選流程（set_flows）與核准變更單。

主線不在這裡——2026-08-15（D38）起主線由流程進度自動判定，前端算，
沒有「推進主線」這回事；2026-08-17 連端點帶這裡的 advance_main_stage 一併移除。
"""
import logging

from django.db import transaction

from main.apps.core.models import ActivityLog
from main.utils.choices import ActivityCategory, ChangeOrderStatus, FlowState
from main.utils.exceptions import BusinessRuleError

logger = logging.getLogger("tjg")


@transaction.atomic
def set_flows(project, flow_item_ids, actor):
    """調整專案勾選的流程（建案後編輯）。

    規則（規劃書第 2 節）：
      · 加勾 → 生單元；重新勾回「不適用」的 → 還原成未開始
      · 取消勾 → 未開始且沒附件就刪；已有紀錄改標「不適用」，歷史要留
    """
    from django.contrib.contenttypes.models import ContentType

    from main.apps.core.models import Attachment
    from main.apps.masters.models import FlowItem
    from main.apps.tracking.models import FlowUnit

    ids = {int(i) for i in flow_item_ids}
    valid = {i.pk: i for i in FlowItem.objects.filter(pk__in=ids, is_active=True)}
    if unknown := ids - set(valid):
        raise BusinessRuleError(f"流程項不存在或已停用：{sorted(unknown)}")

    # ⚠️ 自訂流程（flow_item 為空，D49）不在勾選清單的管轄範圍——
    # 不濾掉的話 None 鍵會落進「取消勾選」分支，把自訂流程整批刪掉
    existing = {
        u.flow_item_id: u
        for u in project.flow_units.filter(flow_item__isnull=False).select_related("flow_item")
    }
    ct = ContentType.objects.get_for_model(FlowUnit)

    added, restored, removed, marked_na = [], [], [], []
    for item_id in ids - set(existing):
        FlowUnit.create_for(project, valid[item_id])
        added.append(valid[item_id].name)
    for item_id in set(existing) & ids:
        unit = existing[item_id]
        if unit.state == FlowState.NA:
            unit.state = FlowState.TODO
            unit.save(update_fields=["state", "updated_at"])
            restored.append(unit.flow_item.name)
    for item_id in set(existing) - ids:
        unit = existing[item_id]
        has_files = Attachment.objects.filter(content_type=ct, object_id=unit.pk).exists()
        has_money = unit.payables.exists() or unit.triggered_milestones.exists()
        if unit.state == FlowState.TODO and not has_files and not has_money:
            unit.delete()
            removed.append(unit.flow_item.name)
        elif unit.state != FlowState.NA:
            unit.state = FlowState.NA
            unit.save(update_fields=["state", "updated_at"])
            marked_na.append(unit.flow_item.name)

    # 勾選增減會讓流程進出排程表——顯示編號跟著位置重編（D51）
    from main.apps.tracking.services.flow_service import renumber_codes

    renumber_codes(project)

    parts = []
    if added:
        parts.append(f"加勾 {'、'.join(added)}")
    if removed:
        parts.append(f"移除 {'、'.join(removed)}")
    if marked_na:
        parts.append(f"標不適用 {'、'.join(marked_na)}")
    if restored:
        parts.append(f"還原 {'、'.join(restored)}")
    if parts:
        ActivityLog.record(
            f"{project.name} 調整流程：{'；'.join(parts)}",
            ActivityCategory.PROJECT, actor=actor, project=project, obj=project,
        )
    return {"added": added, "removed": removed, "marked_na": marked_na, "restored": restored}


@transaction.atomic
def approve_change_order(change_order, actor):
    """核准變更追加單。

    核准後有效合約額改變 → 所有里程碑金額要跟著重算，
    否則「比例 × 合約額」會停留在舊數字。
    """
    from django.utils import timezone

    from main.apps.billing.models import BillingMilestone

    if change_order.status == ChangeOrderStatus.APPROVED:
        raise BusinessRuleError("此變更單已核准")

    change_order.status = ChangeOrderStatus.APPROVED
    change_order.approved_by = actor
    change_order.approved_at = timezone.now()
    change_order.save(update_fields=["status", "approved_by", "approved_at"])

    project = change_order.project
    recalculated = 0
    for milestone in BillingMilestone.objects.filter(project=project).select_related("project"):
        # recalc_amount() 內部會跳過已請款的列——金額已經送出去了，改了就對不上帳
        if milestone.recalc_amount():
            recalculated += 1

    ActivityLog.record(
        f"{project.name} 變更追加單「{change_order.title}」核准，金額 {change_order.amount:,.0f} 元",
        ActivityCategory.PROJECT, actor=actor, project=project, obj=change_order,
    )
    logger.info("變更單 %s 核准，重算 %s 筆里程碑", change_order.code, recalculated)
    return change_order, recalculated
