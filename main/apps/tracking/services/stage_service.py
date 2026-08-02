"""
階段推進、回退與簽收

這一層是全系統業務邏輯的核心。API、Django Admin、management command
都呼叫同一組函式——邏輯只有一份，不會出現「前端能做但後台不能」的落差。
"""
import logging

from django.db import transaction
from django.utils import timezone

from main.apps.billing.services import trigger_service
from main.apps.core.models import ActivityLog, Notification
from main.apps.tracking.models import ProgressLog, TrackingUnit, TrackingUnitStageLog
from main.utils.choices import (
    ActivityCategory,
    NotificationCategory,
    StageDirection,
    Status,
    UnitType,
)
from main.utils.exceptions import BusinessRuleError, ConcurrencyConflict

logger = logging.getLogger("tjg")


class StageMoveResult:
    """推進結果，含副作用——前端據此顯示「已觸發第一期請款」之類的提示"""

    def __init__(self, unit, log, warnings=None, next_action=None, status_changed=None):
        self.unit = unit
        self.log = log
        self.warnings = warnings or []
        self.next_action = next_action
        self.status_changed = status_changed


@transaction.atomic
def move_stage(unit_id, direction, actor, note="", reason_category="", expected_stage_id=None):
    """推進或回退一個階段。

    階段變更、歷程、動態三者在同一交易內——
    絕不會出現「階段變了但沒有歷程」的狀況。
    """
    # of=("self",) 只鎖 tracking_unit 這一列。
    # 不加的話，select_related 到 nullable 外鍵會產生 LEFT JOIN，
    # PostgreSQL 不允許對 outer join 的 nullable 側加鎖。
    unit = TrackingUnit.objects.select_for_update(of=("self",)).select_related(
        "current_stage", "template", "project"
    ).get(pk=unit_id)

    # 樂觀鎖：前端帶著它看到的階段，與現況不符表示有人搶先改了
    if expected_stage_id and unit.current_stage_id != expected_stage_id:
        raise ConcurrencyConflict("階段已被他人變更，請重新整理後再試")

    from_stage = unit.current_stage
    if direction == StageDirection.FORWARD:
        to_stage = from_stage.next_stage
        if to_stage is None:
            raise BusinessRuleError("已在最終階段，無法再推進")
    elif direction == StageDirection.BACKWARD:
        to_stage = from_stage.previous_stage
        if to_stage is None:
            raise BusinessRuleError("已在第一階段，無法再回退")
        if not reason_category:
            raise BusinessRuleError("回退時必須選擇原因類別")
        if not note:
            raise BusinessRuleError("回退時必須填寫說明")
    else:
        raise BusinessRuleError("方向只能是推進或回退")

    # ★ 完成度是「目前這一站做了多少」，不是整批的累計。
    #
    # 換站就歸零重算——24 支鋼柱在「加工」做完 24 支，到了「品檢」
    # 是要重新檢 24 支，不是已經檢完 24 支。
    # 不歸零的話，第二站起一進站就顯示 100%，完成度這個欄位等於作廢。
    #
    # 舊值寫進歷程，「加工那一站到底做了幾支」仍然查得回來。
    qty_at_exit = unit.qty_done if unit.unit_type == UnitType.BATCH else None
    pct_at_exit = unit.progress_pct if unit.unit_type != UnitType.BATCH else None

    unit.current_stage = to_stage
    unit.stage_entered_at = timezone.now()
    if unit.unit_type == UnitType.BATCH:
        unit.qty_done = 0
    else:
        unit.progress_pct = 0

    status_changed = None
    if direction == StageDirection.BACKWARD:
        unit.rollback_count += 1
        old_status = unit.status
        # 回退一次轉「注意」，兩次以上升級「延誤」
        unit.status = Status.DELAYED if unit.rollback_count >= 2 else Status.ATRISK
        if old_status != unit.status:
            status_changed = {
                "from": old_status, "to": unit.status,
                "reason": f"階段回退（第 {unit.rollback_count} 次）",
            }

    unit.save()

    log = TrackingUnitStageLog.objects.create(
        unit=unit, from_stage=from_stage, to_stage=to_stage,
        direction=direction, reason_category=reason_category, note=note, moved_by=actor,
        qty_at_exit=qty_at_exit, pct_at_exit=pct_at_exit,
    )

    arrow = "進入" if direction == StageDirection.FORWARD else "退回"
    ActivityLog.record(
        f"{unit.project.name}·{unit.name} {arrow} {to_stage.name}",
        ActivityCategory.TRACKING, actor=actor, project=unit.project, obj=unit,
    )

    warnings, next_action = [], None

    if to_stage.is_outsource and not unit.outsource_vendor_id:
        warnings.append("此階段需要外包協力廠，尚未填寫。已列入「需要關注」")
        if unit.status == Status.ONTRACK:
            unit.status = Status.ATRISK
            unit.save(update_fields=["status", "updated_at"])

    if to_stage.requires_signoff:
        next_action = {
            "type": "signoff",
            "message": "已進場，待業主／監造簽收。登錄簽收後才會觸發請款",
        }

    if direction == StageDirection.BACKWARD:
        _notify_rollback(unit, from_stage, to_stage, reason_category, note, actor)

    logger.info("追蹤單元 %s：%s → %s（%s）", unit.code, from_stage.name, to_stage.name, direction)
    return StageMoveResult(unit, log, warnings, next_action, status_changed)


def _notify_rollback(unit, from_stage, to_stage, reason_category, note, actor):
    recipients = [unit.project.owner]
    if unit.assignee and unit.assignee != unit.project.owner:
        recipients.append(unit.assignee)
    label = dict(TrackingUnitStageLog._meta.get_field("reason_category").choices).get(
        reason_category, reason_category
    )
    Notification.send(
        recipients,
        title=f"批次回退：{unit.name}",
        body=f"{from_stage.name} → {to_stage.name}\n原因：{label}\n{note}",
        link_url=f"/tracking?unit={unit.pk}",
        category=NotificationCategory.TRACKING,
        dedup_key=f"tracking:rollback:unit_{unit.pk}:{unit.rollback_count}",
    )


@transaction.atomic
def record_signoff(unit_id, actor, signoff_date=None, signoff_by_name="",
                   signoff_doc_no="", signoff_location=None):
    """登錄進場簽收 —— 這是觸發請款的動作（決策 D12／D13）。

    刻意與 move_stage 分開：進入「進場簽收」階段是我們的動作，
    簽收是業主的動作。分開後，看板上「已送到但沒簽」的批次會堆在那裡，
    請款卡在哪一眼看見。
    """
    unit = TrackingUnit.objects.select_for_update(of=("self",)).select_related(
        "current_stage", "project", "phase"
    ).get(pk=unit_id)

    if not unit.current_stage.requires_signoff:
        raise BusinessRuleError(
            f"此追蹤單元目前在「{unit.current_stage.name}」，不是需要簽收的階段"
        )
    if unit.signoff_date:
        raise BusinessRuleError(f"此追蹤單元已於 {unit.signoff_date} 完成簽收")
    if not signoff_by_name:
        raise BusinessRuleError("登錄簽收時必須填寫簽收人")

    unit.signoff_date = signoff_date or timezone.localdate()
    unit.signoff_by_name = signoff_by_name
    unit.signoff_doc_no = signoff_doc_no
    unit.signoff_location = signoff_location
    unit.save(update_fields=[
        "signoff_date", "signoff_by_name", "signoff_doc_no", "signoff_location", "updated_at",
    ])

    ActivityLog.record(
        f"{unit.project.name}·{unit.name} 由 {signoff_by_name} 簽收",
        ActivityCategory.TRACKING, actor=actor, project=unit.project, obj=unit,
    )

    warnings = []
    # 地點比對：不符時警告但不阻擋（現場狀況多變，硬擋會讓人找別的方法繞過）
    milestone = trigger_service.find_milestone_for(unit)
    if milestone and milestone.target_location_id and signoff_location:
        if milestone.target_location_id != signoff_location.pk:
            warnings.append(
                f"簽收地點「{signoff_location.name}」與合約指定的"
                f"「{milestone.target_location.name}」不符"
            )

    result = trigger_service.evaluate(unit, actor=actor)
    warnings.extend(result.warnings)

    logger.info("追蹤單元 %s 簽收；觸發結果：%s", unit.code, result.reason)
    return unit, result, warnings


@transaction.atomic
def report_progress(unit_id, actor, qty_done=None, delta=None, progress_pct=None, note=""):
    """回報進度。

    delta 走 F() 原子更新——兩個師傅同時回報 +5 會正確加 10；
    用絕對值則後者覆蓋前者，少算 5 支。
    """
    unit = TrackingUnit.objects.select_for_update(of=("self",)).get(pk=unit_id)

    if unit.unit_type == UnitType.BATCH:
        before = unit.qty_done
        if delta is not None:
            after = before + delta
        elif qty_done is not None:
            after = qty_done
        else:
            raise BusinessRuleError("請提供完成數量或增減量")

        if after > unit.qty_total:
            raise BusinessRuleError(f"已完成數量不可超過總數量（{unit.qty_total:g}）")
        if after < 0:
            raise BusinessRuleError("已完成數量不可為負")
        if after < before and not note:
            raise BusinessRuleError("數值調降時必須填寫備註")

        unit.qty_done = after
        unit.save(update_fields=["qty_done", "updated_at"])
        log = ProgressLog.objects.create(
            unit=unit, qty_before=before, qty_after=after,
            delta=after - before, note=note, reported_by=actor,
        )
    else:
        before = unit.progress_pct or 0
        if progress_pct is None:
            raise BusinessRuleError("請提供完成百分比")
        if not 0 <= progress_pct <= 100:
            raise BusinessRuleError("完成百分比必須介於 0 與 100 之間")
        if progress_pct < before and not note:
            raise BusinessRuleError("數值調降時必須填寫備註")

        unit.progress_pct = progress_pct
        unit.save(update_fields=["progress_pct", "updated_at"])
        log = ProgressLog.objects.create(
            unit=unit, pct_before=before, pct_after=progress_pct,
            delta=progress_pct - before, note=note, reported_by=actor,
        )

    suggestion = None
    if unit.completion_ratio >= 100 and unit.can_advance:
        suggestion = {
            "type": "advance_stage",
            "message": (
                f"「{unit.current_stage.name}」已全數完成，"
                f"是否推進至「{unit.current_stage.next_stage.name}」？"
                "（推進後完成度會歸零，重新計算新這一站的進度）"
            ),
            "next_stage_id": unit.current_stage.next_stage.pk,
        }

    return unit, log, suggestion


def quick_increments(unit):
    """快速按鈕的級距。依單位決定，前端不用寫判斷。"""
    if unit.unit_of_measure in ("噸", "t", "ton"):
        return [0.5, 1, 5]
    return [1, 5, 10]
