from django.db import models

from main.apps.core.models import TimeStampedModel
from main.utils.choices import TemplateAppliesTo


class StageTemplate(TimeStampedModel):
    """階段模板：一條可設定的流程

    這是「一張表吃兩種業務」的關鍵——鋼構走 9 階段、土建走 5 階段、
    專案主線走 7 階段，全部靠這裡設定，改流程不用改程式。
    """

    code = models.CharField("模板代號", max_length=30, unique=True)
    name = models.CharField("模板名稱", max_length=50)
    applies_to = models.CharField("適用類型", max_length=20, choices=TemplateAppliesTo.choices)
    is_default = models.BooleanField("預設模板", default=False)
    is_active = models.BooleanField("啟用中", default=True)
    note = models.TextField("備註", blank=True)

    class Meta:
        db_table = "masters_stagetemplate"
        verbose_name = verbose_name_plural = "階段模板"
        ordering = ["applies_to", "code"]
        constraints = [
            # 每個適用類型至多一個預設模板
            models.UniqueConstraint(
                fields=["applies_to"], condition=models.Q(is_default=True),
                name="uniq_default_template_per_type",
            ),
        ]

    def __str__(self):
        return self.name

    @property
    def stage_count(self):
        return self.stages.filter(is_active=True).count()

    def first_stage(self):
        return self.stages.filter(is_active=True).order_by("seq").first()

    @classmethod
    def default_for(cls, applies_to):
        return cls.objects.filter(applies_to=applies_to, is_default=True, is_active=True).first()


class Stage(models.Model):
    """階段：流程裡的一站

    五個旗標決定系統在這一站要做什麼事。其中
    `is_billing_trigger` 與 `requires_signoff` 的組合是請款自動化的核心：
      · 只有 is_billing_trigger        → 進入階段即觸發（土建「完成」）
      · 兩者併用                        → 登錄簽收後才觸發（鋼構「進場簽收」）
    """

    template = models.ForeignKey(
        StageTemplate, verbose_name="所屬模板",
        on_delete=models.CASCADE, related_name="stages",
    )
    seq = models.SmallIntegerField("順序", help_text="1 起算")
    code = models.CharField("階段代號", max_length=30)
    name = models.CharField("階段名稱", max_length=30)
    color = models.CharField("顏色", max_length=7, default="#64748b", help_text="#RRGGBB")

    is_billing_trigger = models.BooleanField(
        "觸發請款", default=False,
        help_text="此階段的完成條件達成時，把對應請款里程碑轉為「可請款」",
    )
    requires_signoff = models.BooleanField(
        "需登錄簽收", default=False,
        help_text="需填簽收日／簽收人／單號。與「觸發請款」併用時，"
                  "改為登錄簽收後才觸發，而非進入階段就觸發",
    )
    is_outsource = models.BooleanField(
        "需填協力廠", default=False, help_text="表單自動展開協力廠與進出廠日欄位",
    )
    is_hold = models.BooleanField(
        "等待中", default=False, help_text="此階段不計入產能佔用（如置料區）",
    )
    is_core = models.BooleanField(
        "核心加值", default=False, help_text="工時計入 OEE 與加工成本（手冊第 10 章）",
    )

    stall_days = models.SmallIntegerField(
        "停滯天數門檻", null=True, blank=True,
        help_text="停留超過此天數列入「需要關注」。留空表示不檢查",
    )
    is_active = models.BooleanField("啟用中", default=True)

    class Meta:
        db_table = "masters_stage"
        verbose_name = verbose_name_plural = "階段"
        ordering = ["template", "seq"]
        constraints = [
            models.UniqueConstraint(fields=["template", "seq"], name="uniq_stage_template_seq"),
            models.UniqueConstraint(fields=["template", "code"], name="uniq_stage_template_code"),
            models.CheckConstraint(condition=models.Q(seq__gte=1), name="ck_stage_seq_positive"),
        ]

    def __str__(self):
        return f"{self.seq}. {self.name}"

    def clean(self):
        if self.requires_signoff and not self.is_billing_trigger:
            # 允許，但多數情況是設定錯誤——簽收若不觸發請款，通常沒有意義
            pass

    # ── 流程導航 ───────────────────────────────────────────────────
    @property
    def next_stage(self):
        return (
            Stage.objects.filter(template=self.template, seq__gt=self.seq, is_active=True)
            .order_by("seq").first()
        )

    @property
    def previous_stage(self):
        return (
            Stage.objects.filter(template=self.template, seq__lt=self.seq, is_active=True)
            .order_by("-seq").first()
        )

    @property
    def is_final(self):
        return self.next_stage is None

    @property
    def is_first(self):
        return self.previous_stage is None
