from decimal import Decimal

from django.conf import settings
from django.db import models
from django.utils import timezone
from simple_history.models import HistoricalRecords

from main.apps.core.models import TimeStampedModel
from main.utils.choices import (
    ChangeOrderStatus,
    ProjectLifecycle,
    ProjectType,
    Status,
    TemplateAppliesTo,
)


class ProjectQuerySet(models.QuerySet):
    def active(self):
        """真的在跑的案子。未成交／暫停不算——它們不進看板統計與金流預測。"""
        return self.filter(lifecycle=ProjectLifecycle.ACTIVE)

    def overdue(self):
        return self.filter(is_closed=False, due_date__lt=timezone.localdate())

    def needs_attention(self):
        return self.exclude(status=Status.ONTRACK)

    def with_amounts(self):
        """把「已核准變更」與「已收款」一次算完。

        為什麼用 Subquery 而不是兩個 `annotate(Sum(...))`：
        兩個 Sum 走不同的關聯時，Django 會產生兩層 JOIN，列數相乘，
        **兩個金額都會被放大**。這是 Django 聚合最容易踩的陷阱，
        而且錯得很安靜——金額看起來只是「有點怪」。

        效果：20 筆專案的清單從 40 次查詢降到 1 次。
        """
        from django.db.models import OuterRef, Subquery
        from django.db.models.functions import Coalesce

        from main.apps.billing.models import BillingMilestone
        from main.apps.projects.models.change_order import ChangeOrder

        money = models.DecimalField(max_digits=14, decimal_places=2)

        def summed(model, field, **extra):
            return Coalesce(
                Subquery(
                    model.objects.filter(project=OuterRef("pk"), **extra)
                    .values("project")
                    .annotate(total=models.Sum(field))
                    .values("total"),
                    output_field=money,
                ),
                Decimal("0"),
                output_field=money,
            )

        from main.utils.choices import MilestoneState

        return self.annotate(
            _change_total=summed(ChangeOrder, "amount", status=ChangeOrderStatus.APPROVED),
            _received_total=summed(BillingMilestone, "amount", state=MilestoneState.RECEIVED),
        )


class Project(TimeStampedModel):
    """專案（承攬案）

    一個專案走一條主線（7 階段），底下有很多追蹤單元各自平行推進。
    鋼構案的追蹤單元是「構件批次」，土建案是「工項」，混合案兩者都可以建。
    """

    code = models.CharField("專案編號", max_length=20, unique=True, help_text="P-YYYY-NNN，系統產生")
    name = models.CharField("案名", max_length=200)
    project_type = models.CharField("專案類型", max_length=10, choices=ProjectType.choices)
    customer = models.ForeignKey(
        "masters.Customer", verbose_name="客戶", on_delete=models.PROTECT, related_name="projects",
    )
    contract_amount = models.DecimalField(
        "合約總額", max_digits=14, decimal_places=2, null=True, blank=True,
        help_text="單位：新台幣元。簽約前留空",
    )
    estimate_amount = models.DecimalField(
        "估價金額", max_digits=14, decimal_places=2, null=True, blank=True,
        help_text="未簽約時金流預測與期別金額用它當基準；簽約後以合約額為準",
    )
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, verbose_name="專案負責人",
        on_delete=models.PROTECT, related_name="owned_projects",
    )

    start_date = models.DateField("開工日", null=True, blank=True)
    due_date = models.DateField("預計完工", null=True, blank=True)
    actual_end_date = models.DateField("實際完工", null=True, blank=True)

    main_template = models.ForeignKey(
        "masters.StageTemplate", verbose_name="主線模板",
        on_delete=models.PROTECT, related_name="main_projects",
    )
    main_stage = models.ForeignKey(
        "masters.Stage", verbose_name="目前主線階段",
        on_delete=models.PROTECT, related_name="current_projects",
    )

    status = models.CharField("狀態", max_length=10, choices=Status.choices, default=Status.ONTRACK)
    lifecycle = models.CharField(
        "生命週期", max_length=10, choices=ProjectLifecycle.choices,
        default=ProjectLifecycle.ACTIVE,
        help_text="進行中／未成交／暫停／已結案。從詢價就建案（2026-08-14 確認）",
    )
    # is_closed 由 lifecycle 推導（save() 同步）。留著是因為索引與既有查詢都用它
    is_closed = models.BooleanField("已結案", default=False)

    note = models.CharField("備註", max_length=500, blank=True)
    contract_terms = models.TextField("合約條款", blank=True, help_text="工期、請款條件、罰則、保固")
    quote_info = models.TextField("報價資訊", blank=True)
    doc_links = models.TextField("文件連結", blank=True, help_text="圖紙雲端連結、聯絡窗口等")

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, verbose_name="建立者",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="created_projects",
    )

    history = HistoricalRecords(table_name="projects_project_history")
    objects = ProjectQuerySet.as_manager()

    class Meta:
        db_table = "projects_project"
        verbose_name = verbose_name_plural = "專案"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status"]),
            models.Index(fields=["lifecycle"]),
            models.Index(fields=["is_closed", "due_date"]),
            models.Index(fields=["owner"]),
            models.Index(fields=["project_type"]),
            models.Index(fields=["customer"]),
        ]

    def __str__(self):
        return f"{self.code} {self.name}"

    # ── 金額 ───────────────────────────────────────────────────────
    # 這三個屬性各自要打一次 DB。列表用 ProjectQuerySet.with_amounts() 事先 annotate，
    # 屬性就直接用算好的值——20 筆的清單從 40 次查詢降到 1 次。
    # 單筆存取（如 service 層）沒有 annotate 時仍會自己查，行為一致。
    @property
    def approved_change_amount(self):
        """已核准的變更追加金額合計（可正可負）"""
        cached = getattr(self, "_change_total", None)
        if cached is not None:
            return cached
        agg = self.change_orders.filter(status=ChangeOrderStatus.APPROVED).aggregate(
            total=models.Sum("amount")
        )
        return agg["total"] or Decimal("0")

    @property
    def effective_amount(self):
        """有效合約額＝原合約額＋已核准變更。里程碑金額以此為基礎計算。"""
        base = self.contract_amount or Decimal("0")
        return base + self.approved_change_amount

    @property
    def amount_base(self):
        """期別金額與金流預測的基準。

        簽約後＝有效合約額；簽約前＝估價金額——估價中的案子也要進
        現金流預測（確定性最低的「預估」級），不然預測少算整個未來。
        """
        if self.contract_amount is not None:
            return self.effective_amount
        return self.estimate_amount or Decimal("0")

    @property
    def received_amount(self):
        cached = getattr(self, "_received_total", None)
        if cached is not None:
            return cached
        from main.utils.choices import MilestoneState

        agg = self.milestones.filter(state=MilestoneState.RECEIVED).aggregate(
            total=models.Sum("amount")
        )
        return agg["total"] or Decimal("0")

    @property
    def collection_rate(self):
        """資金收攏率(%)"""
        effective = self.effective_amount
        if not effective:
            return None
        return round(float(self.received_amount / effective * 100), 1)

    # ── 狀態 ───────────────────────────────────────────────────────
    @property
    def is_overdue(self):
        return bool(self.due_date and not self.is_closed and self.due_date < timezone.localdate())

    @property
    def allows_batch(self):
        return self.project_type in (ProjectType.STEEL, ProjectType.MIXED)

    @property
    def allows_work_item(self):
        return self.project_type in (ProjectType.CIVIL, ProjectType.MIXED)

    # ── 編號 ───────────────────────────────────────────────────────
    @classmethod
    def generate_code(cls):
        """P-YYYY-NNN。用資料庫最大值 +1，並在交易內呼叫以避免併發重複。"""
        year = timezone.localdate().year
        prefix = f"P-{year}-"
        last = cls.objects.filter(code__startswith=prefix).order_by("-code").first()
        seq = int(last.code.rsplit("-", 1)[1]) + 1 if last else 1
        return f"{prefix}{seq:03d}"

    def save(self, *args, **kwargs):
        if not self.code:
            self.code = self.generate_code()
        # is_closed 是 lifecycle 的影子欄位，永遠由這裡同步，不各自維護
        self.is_closed = self.lifecycle == ProjectLifecycle.CLOSED
        if "update_fields" in kwargs and kwargs["update_fields"] is not None:
            kwargs["update_fields"] = list(set(kwargs["update_fields"]) | {"is_closed"})
        if not self.main_template_id:
            self.main_template = __import__(
                "main.apps.masters.models", fromlist=["StageTemplate"]
            ).StageTemplate.default_for(TemplateAppliesTo.PROJECT_MAIN)
        if not self.main_stage_id and self.main_template_id:
            self.main_stage = self.main_template.first_stage()
        super().save(*args, **kwargs)
