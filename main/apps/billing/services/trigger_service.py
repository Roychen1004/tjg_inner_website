"""
請款觸發評估

依合約設定的四種方式，判斷簽收後是否該產生請款事件：

  manual            會計人工建立，系統不自動觸發
  all_signed        該期別所有批次都簽收 → 整筆轉可請款
  weight_threshold  累計簽收噸數佔比 ≥ 門檻 → 整筆轉可請款
  per_batch         每批簽收各產生一筆，金額按噸數佔比分攤

★ 分母鎖定（決策 D20）：首次觸發時把該期總噸數固化成快照。
之後新增批次不影響已算過的比例；要改必須綁一張已核准的變更追加單。
"""
import logging
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction
from django.utils import timezone

from main.apps.billing.models import BillingClaim, BillingClaimLog, BillingMilestone
from main.apps.core.models import ActivityLog, Notification, Role, User
from main.utils.choices import (
    ActivityCategory,
    ClaimSource,
    ClaimState,
    MilestoneState,
    NotificationCategory,
    TriggerType,
)

logger = logging.getLogger("tjg")


@dataclass
class TriggerResult:
    """評估結果。無論有沒有產生請款，都回傳進度供前端顯示。"""

    milestone: BillingMilestone | None = None
    claim: BillingClaim | None = None
    triggered: bool = False
    reason: str = ""
    signed_units: int = 0
    total_units: int = 0
    signed_weight_kg: Decimal = Decimal("0")
    total_weight_kg: Decimal = Decimal("0")
    pct: float = 0.0
    warnings: list[str] = field(default_factory=list)

    @property
    def progress_text(self):
        if not self.total_units:
            return "尚無批次"
        parts = [f"已簽收 {self.signed_units}/{self.total_units} 批"]
        if self.total_weight_kg:
            parts.append(f"{self.signed_weight_kg / 1000:.1f}/{self.total_weight_kg / 1000:.1f} 噸（{self.pct:.1f}%）")
        return "，".join(parts)


def find_milestone_for(unit):
    """找出這個追蹤單元的簽收該觸發哪一筆里程碑。

    優先比對期別；沒有期別時取該專案最早一筆尚未收足的里程碑。
    """
    qs = BillingMilestone.objects.filter(project=unit.project).exclude(
        trigger_type=TriggerType.MANUAL
    )
    if unit.phase_id:
        matched = qs.filter(phase=unit.phase).order_by("seq").first()
        if matched:
            return matched
    return qs.filter(phase__isnull=True).order_by("seq").first()


def _phase_units(milestone):
    """該里程碑涵蓋的追蹤單元"""
    from main.apps.tracking.models import TrackingUnit

    qs = TrackingUnit.objects.filter(project=milestone.project)
    return qs.filter(phase=milestone.phase) if milestone.phase_id else qs


def _lock_weight_basis(milestone, total_weight):
    """首次觸發時固化分母。之後新增批次不會改變已算過的比例。"""
    if milestone.is_weight_basis_locked:
        return milestone.weight_basis_kg
    milestone.weight_basis_kg = total_weight
    milestone.weight_basis_locked_at = timezone.now()
    milestone.save(update_fields=["weight_basis_kg", "weight_basis_locked_at", "updated_at"])
    logger.info("里程碑「%s」分母已鎖定為 %s kg", milestone.label, total_weight)
    return total_weight


def evaluate(unit, actor=None):
    """簽收後評估是否產生請款事件。

    找不到里程碑、未達門檻、重量未填等情況都不視為錯誤——
    回傳結果讓呼叫端決定要顯示什麼，絕不中斷簽收本身。
    """
    result = TriggerResult()

    milestone = find_milestone_for(unit)
    if milestone is None:
        result.reason = "找不到對應的請款里程碑"
        result.warnings.append("此專案尚未設定請款里程碑，簽收已記錄但不會觸發請款")
        logger.warning("追蹤單元 %s 簽收後找不到對應里程碑", unit.code)
        return result

    result.milestone = milestone

    units = _phase_units(milestone)
    signed = units.filter(signoff_date__isnull=False)
    result.total_units = units.count()
    result.signed_units = signed.count()

    total_weight = sum((u.total_weight_kg or Decimal("0")) for u in units)
    signed_weight = sum((u.total_weight_kg or Decimal("0")) for u in signed)
    result.total_weight_kg = total_weight
    result.signed_weight_kg = signed_weight
    result.pct = float(signed_weight / total_weight * 100) if total_weight else 0.0

    handler = {
        TriggerType.ALL_SIGNED: _eval_all_signed,
        TriggerType.WEIGHT_THRESHOLD: _eval_weight_threshold,
        TriggerType.PER_BATCH: _eval_per_batch,
    }.get(milestone.trigger_type)

    if handler is None:
        result.reason = "此里程碑為手動觸發，不自動產生請款"
        return result

    return handler(unit, milestone, units, signed, result, actor)


# ── 三種自動觸發 ───────────────────────────────────────────────────
def _eval_all_signed(unit, milestone, units, signed, result, actor):
    if result.signed_units < result.total_units:
        remaining = result.total_units - result.signed_units
        result.reason = f"尚有 {remaining} 批未簽收"
        return result

    if milestone.claims.exists():
        result.reason = "此里程碑已產生過請款"
        return result

    result.claim = _create_claim(
        milestone, milestone.amount, unit, actor,
        note=f"該期 {result.total_units} 批全數簽收",
    )
    result.triggered = True
    result.reason = f"該期 {result.total_units} 批全數簽收，全額轉可請款"
    return result


def _eval_weight_threshold(unit, milestone, units, signed, result, actor):
    if not result.total_weight_kg:
        result.reason = "該期批次尚未填寫總重量，無法計算門檻"
        result.warnings.append("請先填寫各批次的總重量（限廠長／專案負責人／經營者）")
        return result

    threshold = float(milestone.threshold_pct or 0)
    if result.pct < threshold:
        result.reason = f"累計 {result.pct:.1f}%，未達門檻 {threshold:g}%"
        return result

    if milestone.claims.exists():
        result.reason = "此里程碑已產生過請款"
        return result

    _lock_weight_basis(milestone, result.total_weight_kg)
    result.claim = _create_claim(
        milestone, milestone.amount, unit, actor,
        weight=result.signed_weight_kg,
        note=f"累計簽收 {result.pct:.1f}% 達門檻 {threshold:g}%",
    )
    result.triggered = True
    result.reason = f"累計 {result.pct:.1f}% 已達門檻 {threshold:g}%，全額轉可請款"
    return result


def _eval_per_batch(unit, milestone, units, signed, result, actor):
    if milestone.claims.filter(triggered_by_unit=unit).exists():
        result.reason = "此批次已產生過請款"
        return result

    unit_weight = unit.total_weight_kg
    if not unit_weight:
        result.reason = "此批次未填寫總重量，無法計算分批金額"
        result.warnings.append("請先填寫本批次的總重量（限廠長／專案負責人／經營者）")
        return result

    basis = _lock_weight_basis(milestone, result.total_weight_kg)
    if not basis:
        result.reason = "該期總重量為 0，無法計算佔比"
        return result

    share = (milestone.amount * unit_weight / basis).quantize(Decimal("0.01"), ROUND_HALF_UP)

    # 不讓累計超過里程碑總額（浮動誤差或後補批次可能造成）
    remaining = milestone.amount - milestone.claimable_amount
    if share > remaining:
        share = remaining
        result.warnings.append("本筆金額已調整為剩餘可請金額，避免超過里程碑總額")
    if share <= 0:
        result.reason = "此里程碑金額已全數轉為可請款"
        return result

    result.claim = _create_claim(
        milestone, share, unit, actor, weight=unit_weight,
        note=f"{unit.name} 佔 {unit_weight / basis * 100:.1f}%",
    )
    result.triggered = True
    result.reason = (
        f"本批 {unit_weight / 1000:.1f} 噸，佔該期 {unit_weight / basis * 100:.1f}%，"
        f"可請 {share:,.0f} 元"
    )
    return result


# ── 建立請款事件 ───────────────────────────────────────────────────
@transaction.atomic
def _create_claim(milestone, amount, unit, actor, weight=None, note=""):
    claim = BillingClaim.objects.create(
        milestone=milestone,
        amount=amount,
        source=ClaimSource.AUTO_SIGNOFF,
        triggered_by_unit=unit,
        state=ClaimState.CLAIMABLE,
        weight_kg_snapshot=weight,
        note=note,
    )
    BillingClaimLog.objects.create(
        claim=claim, from_state="", to_state=ClaimState.CLAIMABLE,
        is_auto=True, amount_snapshot=amount,
    )
    recalc_milestone(milestone)

    verb = f"{milestone.project.name}·{milestone.label} 可請款 {amount:,.0f} 元（{unit.name} 簽收）"
    ActivityLog.record(verb, ActivityCategory.BILLING, actor=actor, project=milestone.project, obj=claim)

    finance_users = User.objects.filter(groups__name__in=[Role.FINANCE, Role.OWNER], is_active=True).distinct()
    Notification.send(
        list(finance_users),
        title=f"可請款：{milestone.label}",
        body=f"{milestone.project.name}\n{note}\n金額 {amount:,.0f} 元",
        link_url=f"/billing?milestone={milestone.pk}",
        category=NotificationCategory.BILLING,
        dedup_key=f"billing:claimable:claim_{claim.pk}",
    )
    logger.info("產生請款事件 %s：%s 元", claim.pk, amount)
    return claim


def recalc_milestone(milestone):
    """由請款事件重算里程碑的三個累計金額與彙總狀態。

    ⚠️ 一定要重新查 DB，不能用 `milestone.claims.all()`。

    呼叫端常常是從 ViewSet 拿到的物件，而那個 queryset 有
    `prefetch_related("claims")`——related manager 會回傳**建立新請款之前**
    的快取，於是每次重算都慢一拍：
    第一次請款算成 0、第二次才算到第一筆，剩餘金額的檢查因此形同虛設
    （實測：同一筆里程碑可以請兩次）。
    """
    claims = BillingClaim.objects.filter(milestone=milestone)
    claimable = sum(c.amount for c in claims)
    claimed = sum(c.amount for c in claims if c.state in (ClaimState.INVOICED, ClaimState.RECEIVED))
    received = sum(c.amount for c in claims if c.state == ClaimState.RECEIVED)

    milestone.claimable_amount = claimable
    milestone.claimed_amount = claimed
    milestone.received_amount = received

    if received and received >= milestone.amount:
        state = MilestoneState.RECEIVED
    elif claimed and claimed >= claimable and claimable >= milestone.amount:
        state = MilestoneState.INVOICED
    elif claimed:
        state = MilestoneState.PARTIAL
    elif claimable:
        state = MilestoneState.CLAIMABLE
    else:
        state = MilestoneState.PENDING

    milestone.state = state
    if state != MilestoneState.PENDING and milestone.claimable_at is None:
        milestone.claimable_at = timezone.now()

    milestone.save(update_fields=[
        "claimable_amount", "claimed_amount", "received_amount",
        "state", "claimable_at", "updated_at",
    ])
    return milestone
