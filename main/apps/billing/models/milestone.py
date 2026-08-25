from decimal import Decimal

from django.conf import settings
from django.db import models
from simple_history.models import HistoricalRecords

from main.apps.core.models import ImmutableLogModel, TimeStampedModel
from main.utils.choices import MilestoneState


class BillingMilestoneQuerySet(models.QuerySet):
    def outstanding(self):
        return self.exclude(state=MilestoneState.RECEIVED)

    def received(self):
        return self.filter(state=MilestoneState.RECEIVED)


class BillingMilestone(TimeStampedModel):
    """應收款 —— 合約付款條件的一列，同時就是實際請款的那一列

    合約寫「簽約 30%、出貨 40%、驗收 30%」就是三列，各自走：
        未到 → 可請款 → 已請款 → 已收款

    2026-08-13 簡化：原本分「里程碑（合約條件）」與「請款事件（實際請款）」
    兩層，是為了鋼構分批出貨分批請款。實務確認**每期就是請一次**，
    第二層與整套自動觸發（簽收觸發、重量門檻、分母鎖定）都拆掉了。
    真的遇到一期要分兩次請，就把那一期拆成兩列。
    """

    project = models.ForeignKey(
        "projects.Project", verbose_name="專案",
        on_delete=models.CASCADE, related_name="milestones",
    )
    seq = models.SmallIntegerField("順序")
    label = models.CharField("名稱", max_length=100, help_text="如「第一期（簽約）」")
    condition = models.CharField(
        "合約條件", max_length=200, blank=True,
        help_text="合約原文，如「構件全數運抵工地並經業主簽收」。提醒自己何時可以請",
    )
    percentage = models.DecimalField("比例(%)", max_digits=5, decimal_places=2)
    amount = models.DecimalField(
        "金額", max_digits=14, decimal_places=2, default=Decimal("0"),
        help_text="系統計算＝有效合約額×比例。變更單核准時，尚未請款的列會重算",
    )

    state = models.CharField(
        "狀態", max_length=12, choices=MilestoneState.choices, default=MilestoneState.PENDING,
    )
    trigger_unit = models.ForeignKey(
        "tracking.FlowUnit", verbose_name="觸發流程",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="triggered_milestones",
        help_text="這個流程完成 → 本期自動轉「可請款」並通知（金流軌）。"
                  "沒填預計請款日時，現金流預估用它的預計完成日",
    )
    accountant = models.ForeignKey(
        settings.AUTH_USER_MODEL, verbose_name="負責收款的會計師",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="assigned_milestones",
        help_text="D45：觸發流程完成轉可請款時通知這個人，"
                  "並出現在他的「我的任務」待收款清單",
    )
    expected_date = models.DateField(
        "預計請款日", null=True, blank=True,
        help_text="現金流預估靠它。填大概的月份即可，之後隨時可改",
    )
    claimable_at = models.DateTimeField(
        "轉可請款時間", null=True, blank=True,
        help_text="「可請款放了 N 天沒開單」的提醒基準",
    )
    invoice_date = models.DateField("請款日", null=True, blank=True)
    invoice_no = models.CharField("請款單號", max_length=30, blank=True)
    due_date = models.DateField(
        "預計收款日", null=True, blank=True,
        help_text="請款日＋客戶帳期，開單時自動帶入，可覆寫。現金流的收入側靠它落格",
    )
    receive_date = models.DateField("收款日", null=True, blank=True)
    note = models.CharField("備註", max_length=300, blank=True)

    history = HistoricalRecords(table_name="billing_milestone_history")
    objects = BillingMilestoneQuerySet.as_manager()

    class Meta:
        db_table = "billing_billingmilestone"
        verbose_name = verbose_name_plural = "應收款"
        ordering = ["project", "seq"]
        constraints = [
            models.UniqueConstraint(fields=["project", "seq"], name="uniq_milestone_project_seq"),
            models.CheckConstraint(condition=models.Q(seq__gte=1), name="ck_milestone_seq_positive"),
            models.CheckConstraint(
                condition=models.Q(percentage__gte=0) & models.Q(percentage__lte=100),
                name="ck_milestone_pct_range",
            ),
        ]
        indexes = [
            models.Index(fields=["project", "state"]),
            models.Index(fields=["state", "expected_date"]),
            models.Index(fields=["state", "due_date"]),
        ]

    def __str__(self):
        return f"{self.project.name}·{self.label}"

    # ── 金額 ───────────────────────────────────────────────────────
    @property
    def received_amount(self):
        return self.amount if self.state == MilestoneState.RECEIVED else Decimal("0")

    @property
    def outstanding_amount(self):
        """還沒收到的錢"""
        return Decimal("0") if self.state == MilestoneState.RECEIVED else self.amount

    @property
    def forecast_date(self):
        """未到期別的預估請款日：自己填的優先，沒填就用觸發流程的預計完成日。"""
        if self.expected_date:
            return self.expected_date
        if self.trigger_unit_id and self.trigger_unit.plan_end:
            return self.trigger_unit.plan_end
        return None

    def recalc_amount(self):
        """金額＝金額基準 × 比例。

        基準＝有效合約額；未簽約時＝估價金額（2026-08-14 確認）——
        估價中的案子也要有期別金額，金流預測才有東西可算。
        只在還沒請款時重算——已經送出去給業主的數字不能被系統改掉。
        """
        if self.state in (MilestoneState.INVOICED, MilestoneState.RECEIVED):
            return False
        new_amount = (self.project.amount_base * self.percentage / Decimal("100")).quantize(
            Decimal("1")
        )
        if new_amount != self.amount:
            self.amount = new_amount
            self.save(update_fields=["amount", "updated_at"])
            return True
        return False


class MilestoneLog(ImmutableLogModel):
    """應收款狀態異動歷程。

    錢的狀態被改過而沒人知道，是查帳時最麻煩的事——
    這張表只能新增，不能改不能刪。
    """

    milestone = models.ForeignKey(
        BillingMilestone, verbose_name="應收款",
        on_delete=models.CASCADE, related_name="logs",
    )
    from_state = models.CharField("原狀態", max_length=12, blank=True)
    to_state = models.CharField("新狀態", max_length=12)
    reason = models.CharField("原因", max_length=500, blank=True, help_text="往回轉時必填")
    amount_snapshot = models.DecimalField("金額快照", max_digits=14, decimal_places=2)
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, verbose_name="操作者",
        on_delete=models.SET_NULL, null=True, related_name="+",
    )
    changed_at = models.DateTimeField("時間", auto_now_add=True)

    class Meta:
        db_table = "billing_milestonelog"
        verbose_name = verbose_name_plural = "應收款歷程"
        ordering = ["-changed_at"]
