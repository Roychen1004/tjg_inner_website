"""
流程單元的狀態轉換與進度回報

狀態機（FlowState）：
    未開始 ──開始──▶ 進行中 ──完成──▶ 已完成
    未開始 ──直接完成──▶ 已完成          （小事不必先按開始）
    已完成 ──重啟（必填原因）──▶ 進行中
    未開始 ⇄ 不適用                     （只有專案管理者能標，勾選流程時用）

負責人（assignee）可以操作自己的單元；其餘操作需要 edit_tracking。
權限檢查在 view 層做完才進來——這裡只管業務規則。
"""
import logging

from django.db import transaction
from django.utils import timezone

from main.apps.core.models import ActivityLog
from main.apps.tracking.models import FlowUnit
from main.utils.choices import ActivityCategory, FlowState
from main.utils.exceptions import BusinessRuleError

logger = logging.getLogger("tjg")

# 允許的轉換：目前狀態 → 可去的狀態
ALLOWED = {
    FlowState.TODO: {FlowState.DOING, FlowState.DONE, FlowState.NA},
    FlowState.DOING: {FlowState.DONE, FlowState.TODO},
    FlowState.DONE: {FlowState.DOING},
    FlowState.NA: {FlowState.TODO},
}

# 這些轉換必填原因——回頭路要留下為什麼
REASON_REQUIRED = {
    (FlowState.DONE, FlowState.DOING),
    (FlowState.DOING, FlowState.TODO),
}


@transaction.atomic
def transition(unit_id, to_state, actor, note=""):
    unit = (
        FlowUnit.objects.select_for_update(of=("self",))
        .select_related("flow_item", "project")
        .get(pk=unit_id)
    )
    from_state = unit.state
    if to_state == from_state:
        raise BusinessRuleError(f"已經是「{unit.get_state_display()}」了")
    if to_state not in ALLOWED.get(from_state, set()):
        raise BusinessRuleError(
            f"不能從「{unit.get_state_display()}」直接變成"
            f"「{dict(FlowState.choices)[to_state]}」"
        )
    if (from_state, to_state) in REASON_REQUIRED and not note:
        raise BusinessRuleError("往回改狀態時必須填寫原因")

    today = timezone.localdate()
    unit.state = to_state
    if to_state == FlowState.DOING and from_state == FlowState.TODO:
        unit.actual_start = unit.actual_start or today
    elif to_state == FlowState.DONE:
        unit.actual_start = unit.actual_start or today
        unit.actual_end = unit.actual_end or today
        # 完成＝做完了。有數量的補滿數量，有百分比的補到 100——
        # 「已完成但進度 60%」是矛盾的資料，之後每張報表都要多寫一個 if
        if unit.qty_total:
            unit.qty_done = unit.qty_total
        if unit.progress_pct is not None:
            unit.progress_pct = 100
    elif to_state == FlowState.DOING and from_state == FlowState.DONE:
        unit.actual_end = None
    elif to_state == FlowState.TODO:
        unit.actual_start = None
        unit.actual_end = None
    unit.save()

    label = dict(FlowState.choices)[to_state]
    suffix = f"（{note}）" if note else ""
    ActivityLog.record(
        f"{unit.project.name}·{unit.flow_display_name} → {label}{suffix}",
        ActivityCategory.TRACKING, actor=actor, project=unit.project, obj=unit,
    )
    logger.info("流程單元 %s：%s → %s", unit.pk, from_state, to_state)

    if to_state == FlowState.DONE:
        _on_completed(unit, actor)
    elif from_state == FlowState.DONE:
        # 重啟（D46）：掛在這個流程上、還停在「可請款」的期別自動退回未到
        from main.apps.billing.services import trigger_service

        trigger_service.on_trigger_reopened(unit, actor)
    # 標不適用／還原會讓一條流程進出排程表——顯示編號跟著位置重編（D51）
    if FlowState.NA in (from_state, to_state):
        renumber_codes(unit.project)
    return unit


def renumber_codes(project):
    """把專案內流程的顯示編號依目前順序重編（D51，老闆要求）。

    3.4 拖到 3.3 前面，顯示就變 3.3——編號是**位置**，不是身分。
    一個階段一組、從 1 起算；「不適用」的不佔號。
    用 queryset.update：顯示編號不是業務事實，不進歷史紀錄。
    """
    units = list(
        project.flow_units.exclude(state=FlowState.NA)
        .select_related("flow_item__stage", "stage")
        .order_by("seq", "id")
    )
    counters = {}
    for unit in units:
        stage = unit.display_stage
        seq = stage.seq if stage else 0
        counters[seq] = counters.get(seq, 0) + 1
        code = f"{seq}.{counters[seq]}"
        if unit.code != code:
            FlowUnit.objects.filter(pk=unit.pk).update(code=code)


def _on_completed(unit, actor):
    """單元完成後的連鎖動作：金流軌自動觸發＋通知。各自有 dedup，不會轟炸。"""
    from main.apps.billing.services import trigger_service
    from main.apps.tracking.services import notify_service

    trigger_service.auto_claimable(unit, actor)
    notify_service.flow_completed(unit, actor)


@transaction.atomic
def report_progress(unit_id, actor, qty_done=None, delta=None, progress_pct=None, note=""):
    """回報進度（不改狀態）。負責人在「我的任務」按的就是這個。

    delta 走原子加總——兩人同時 +5 會正確加 10。
    """
    unit = (
        FlowUnit.objects.select_for_update(of=("self",))
        .select_related("flow_item", "project")
        .get(pk=unit_id)
    )
    if unit.state in (FlowState.DONE, FlowState.NA):
        raise BusinessRuleError("已完成或不適用的單元不能回報進度，請先改回進行中")
    if unit.is_batch_driven:
        raise BusinessRuleError(
            "此流程的進度由構件批次自動彙總，請到批次看板推進批次"
        )

    if qty_done is not None or delta is not None:
        if not unit.qty_total:
            raise BusinessRuleError("此單元沒有設定總數量，請回報百分比或請管理者補設定")
        before = unit.qty_done
        after = before + delta if delta is not None else qty_done
        if after > unit.qty_total:
            raise BusinessRuleError(f"已完成數量不可超過總數量（{unit.qty_total:g}）")
        if after < 0:
            raise BusinessRuleError("已完成數量不可為負")
        if after < before and not note:
            raise BusinessRuleError("數值調降時必須填寫備註")
        unit.qty_done = after
    elif progress_pct is not None:
        if not 0 <= progress_pct <= 100:
            raise BusinessRuleError("完成百分比必須介於 0 與 100 之間")
        before = unit.progress_pct or 0
        if progress_pct < before and not note:
            raise BusinessRuleError("數值調降時必須填寫備註")
        unit.progress_pct = progress_pct
    else:
        raise BusinessRuleError("請提供完成數量、增減量或完成百分比其中之一")

    if unit.state == FlowState.TODO:
        unit.state = FlowState.DOING
        unit.actual_start = unit.actual_start or timezone.localdate()
    unit.save()

    ActivityLog.record(
        f"{unit.project.name}·{unit.flow_display_name} 進度 {unit.completion_ratio:g}%"
        + (f"（{note}）" if note else ""),
        ActivityCategory.TRACKING, actor=actor, project=unit.project, obj=unit,
    )
    return unit


def can_operate(user, unit):
    """負責人能動自己的單元；其他人要有 edit_tracking。"""
    from main.utils.permissions import has_permission

    if has_permission(user, "edit_tracking"):
        return True
    return bool(unit.assignee_id and unit.assignee_id == user.pk)


def gantt_rows(project):
    """專案卡片迷你甘特的資料：五大階段各縮成一條 bar。

    吃 prefetch 進來的 flow_units（呼叫端要先
    prefetch_related("flow_units__flow_item__stage")），這裡不打 DB。
    """
    today = timezone.localdate()
    groups = {}
    for unit in project.flow_units.all():
        if unit.state == FlowState.NA:
            continue
        stage = unit.display_stage
        if stage is None:
            continue
        g = groups.setdefault(stage.seq, {
            "seq": stage.seq, "name": stage.name,
            "start": None, "end": None,
            "total": 0, "done": 0, "doing": 0, "overdue": False,
        })
        g["total"] += 1
        if unit.state == FlowState.DONE:
            g["done"] += 1
        elif unit.state == FlowState.DOING:
            g["doing"] += 1
        if unit.plan_start and (g["start"] is None or unit.plan_start < g["start"]):
            g["start"] = unit.plan_start
        if unit.plan_end and (g["end"] is None or unit.plan_end > g["end"]):
            g["end"] = unit.plan_end
        if (
            unit.state in (FlowState.TODO, FlowState.DOING)
            and unit.plan_end and unit.plan_end < today
        ):
            g["overdue"] = True
    return sorted(groups.values(), key=lambda g: g["seq"])


def sync_batch_rollup(project, actor=None):
    """把構件批次的位置彙總回階段 4 的流程單元（批次是唯一的事實來源）。

    一張批次同時餵四個單元：走過 batch_stage_seq（含）就算進該流程的完成數。
    例：批次到「待出貨」(5) ⇒ 廠內加工(3)、表面處理(5) 都算完成一批。

    批次推進、回退、新增、刪除後都要呼叫——qty 與狀態全部由此回寫：
      全部過門檻 → 已完成（帶動金流軌與通知）
      部分過門檻 → 進行中；回退到門檻以下 → 已完成退回進行中
    """
    from main.utils.choices import FlowState as S

    units = list(
        project.flow_units.filter(flow_item__batch_stage_seq__isnull=False)
        .exclude(state=S.NA)
        .select_related("flow_item", "project")
    )
    if not units:
        return
    batches = list(project.units.select_related("current_stage").only("current_stage__seq"))
    total = len(batches)

    from django.utils import timezone

    today = timezone.localdate()
    for unit in units:
        done = sum(1 for b in batches if b.current_stage.seq >= unit.flow_item.batch_stage_seq)
        was_done = unit.state == S.DONE
        unit.qty_total = total or None
        unit.qty_done = done
        unit.unit_of_measure = "批"
        all_past = total > 0 and done >= total

        if all_past and not was_done:
            unit.state = S.DONE
            unit.actual_start = unit.actual_start or today
            unit.actual_end = unit.actual_end or today
        elif not all_past and was_done:
            unit.state = S.DOING
            unit.actual_end = None
        elif not all_past and unit.state == S.TODO and done > 0:
            unit.state = S.DOING
            unit.actual_start = unit.actual_start or today
        unit.save()

        if all_past and not was_done:
            _on_completed(unit, actor)
