"""
階段推進與進度回報

API 與 Django Admin 都呼叫同一組函式——邏輯只有一份，
不會出現「前端能做但後台不能」的落差。
"""
import logging

from django.db import transaction
from django.utils import timezone

from main.apps.core.models import ActivityLog
from main.apps.tracking.models import ProgressLog, TrackingUnit, TrackingUnitStageLog
from main.utils.choices import ActivityCategory, StageDirection, UnitType
from main.utils.exceptions import BusinessRuleError, ConcurrencyConflict

logger = logging.getLogger("tjg")


@transaction.atomic
def move_stage(unit_id, direction, actor, note="", expected_stage_id=None):
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
    else:
        raise BusinessRuleError("方向只能是推進或回退")

    # ★ 完成度是「目前這一站做了多少」，不是整批的累計。
    #
    # 換站就歸零重算——24 支鋼柱在「加工」做完 24 支，到了下一站
    # 是重新開始算新站的量。不歸零的話，第二站起一進站就顯示 100%。
    # 舊值寫進歷程，「加工那一站到底做了幾支」仍然查得回來。
    qty_at_exit = unit.qty_done if unit.unit_type == UnitType.BATCH else None
    pct_at_exit = unit.progress_pct if unit.unit_type != UnitType.BATCH else None

    unit.current_stage = to_stage
    unit.stage_entered_at = timezone.now()
    if unit.unit_type == UnitType.BATCH:
        unit.qty_done = 0
    else:
        unit.progress_pct = 0
    unit.save()

    log = TrackingUnitStageLog.objects.create(
        unit=unit, from_stage=from_stage, to_stage=to_stage,
        direction=direction, note=note, moved_by=actor,
        qty_at_exit=qty_at_exit, pct_at_exit=pct_at_exit,
    )

    arrow = "進入" if direction == StageDirection.FORWARD else "退回"
    ActivityLog.record(
        f"{unit.project.name}·{unit.name} {arrow} {to_stage.name}",
        ActivityCategory.TRACKING, actor=actor, project=unit.project, obj=unit,
    )
    logger.info("追蹤單元 %s：%s → %s（%s）", unit.code, from_stage.name, to_stage.name, direction)

    # 批次走站 → 階段 4 的流程單元（加工/表處/出貨/安裝）進度跟著動（同交易）
    if unit.unit_type == UnitType.BATCH:
        from main.apps.tracking.services import flow_service

        flow_service.sync_batch_rollup(unit.project, actor)
    return unit, log


@transaction.atomic
def report_progress(unit_id, actor, qty_done=None, delta=None, progress_pct=None, note=""):
    """回報進度。

    delta 走原子更新——兩個人同時回報 +5 會正確加 10；
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
