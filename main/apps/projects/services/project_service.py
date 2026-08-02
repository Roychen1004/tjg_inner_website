"""
專案主線推進

與追蹤單元的階段推進是同一個概念，但物件不同：
專案走「接案→深化設計→報價→採購備料→施工中→完工驗收→結案」，
追蹤單元走構件批次或土建工項的流程。
"""
import logging

from django.db import transaction

from main.apps.core.models import ActivityLog
from main.apps.projects.models import Project
from main.utils.choices import ActivityCategory, ChangeOrderStatus, MilestoneState
from main.utils.exceptions import BusinessRuleError, ConfirmationRequired

logger = logging.getLogger("tjg")


@transaction.atomic
def advance_main_stage(project_id, direction, actor, note="", confirmed=False):
    """推進或回退專案主線。

    推進到最終階段（結案）前會擋一次——尚有未收款就要求二次確認。
    這不是刁難，是「結案後沒人會再看這個案子」的現實。
    """
    project = Project.objects.select_for_update(of=("self",)).select_related(
        "main_stage", "main_template"
    ).get(pk=project_id)

    if project.is_closed:
        raise BusinessRuleError("此專案已結案，無法變更階段")

    from_stage = project.main_stage
    if direction == "forward":
        to_stage = from_stage.next_stage
        if to_stage is None:
            raise BusinessRuleError("已在最終階段，無法再推進")
    else:
        to_stage = from_stage.previous_stage
        if to_stage is None:
            raise BusinessRuleError("已在第一階段，無法再回退")

    warnings = []
    if to_stage.is_final and not confirmed:
        outstanding = _outstanding_summary(project)
        if outstanding["amount"] > 0:
            raise ConfirmationRequired(
                detail=(
                    f"此專案尚有 {outstanding['count']} 筆、合計 "
                    f"{outstanding['amount']:,.0f} 元未收款，確定要結案？"
                ),
                context=outstanding,
            )

    if to_stage.is_final:
        pending_units = _unfinished_unit_count(project)
        if pending_units:
            warnings.append(f"尚有 {pending_units} 個追蹤單元未走到最後階段")

    project.main_stage = to_stage
    if to_stage.is_final:
        project.is_closed = True
    project.save(update_fields=["main_stage", "is_closed", "updated_at"])

    arrow = "進入" if direction == "forward" else "退回"
    ActivityLog.record(
        f"{project.name} {arrow} {to_stage.name}" + (f"（{note}）" if note else ""),
        ActivityCategory.PROJECT, actor=actor, project=project, obj=project,
    )
    logger.info("專案 %s：%s → %s", project.code, from_stage.name, to_stage.name)
    return project, warnings


def _unfinished_unit_count(project):
    """還沒走到自己那條流程最後一站的追蹤單元數。

    每個單元的模板可能不同（鋼構 9 站、土建 5 站），
    所以要各自比對自己模板的最後一站，不能用同一個數字。
    """
    last_seq = {}
    count = 0
    for unit in project.units.select_related("current_stage", "template").only(
        "current_stage__seq", "template_id"
    ):
        if unit.template_id not in last_seq:
            stage = unit.template.stages.filter(is_active=True).order_by("-seq").first()
            last_seq[unit.template_id] = stage.seq if stage else 0
        if unit.current_stage.seq < last_seq[unit.template_id]:
            count += 1
    return count


def _outstanding_summary(project):
    """未收款彙總。結案前的二次確認要說出具體數字，不能只說「還有錢沒收」。"""
    from main.apps.billing.models import BillingClaim

    claims = BillingClaim.objects.filter(milestone__project=project).exclude(
        state="received"
    )
    total = sum(c.amount for c in claims)
    pending = project.milestones.filter(state=MilestoneState.PENDING).count()
    return {
        "count": claims.count(),
        "amount": total,
        "pending_milestones": pending,
    }


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
        # 已經開過請款的里程碑不動——金額已經送出去了，改了就對不上帳
        if milestone.claims.exists():
            continue
        milestone.recalc_amount()
        recalculated += 1

    ActivityLog.record(
        f"{project.name} 變更追加單「{change_order.title}」核准，金額 {change_order.amount:,.0f} 元",
        ActivityCategory.PROJECT, actor=actor, project=project, obj=change_order,
    )
    logger.info("變更單 %s 核准，重算 %s 筆里程碑", change_order.code, recalculated)
    return change_order, recalculated
