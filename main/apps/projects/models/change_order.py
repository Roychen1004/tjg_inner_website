from django.conf import settings
from django.db import models
from django.utils import timezone
from simple_history.models import HistoricalRecords

from main.utils.choices import ChangeOrderStatus


class ChangeOrder(models.Model):
    """變更追加單

    只有 status='approved' 才計入有效合約額，並連帶重算所有里程碑金額。

    另一個關鍵用途（決策 D20）：請款分母一旦鎖定，要修改就必須綁一張
    已核准的變更單。這把「要改就得重簽合約」從管理規定變成技術上做不到的事。
    """

    code = models.CharField("變更單號", max_length=30, unique=True, help_text="CO-YYYY-NNN")
    project = models.ForeignKey(
        "projects.Project", verbose_name="專案",
        on_delete=models.CASCADE, related_name="change_orders",
    )
    title = models.CharField("標題", max_length=200)
    amount = models.DecimalField(
        "變更金額", max_digits=14, decimal_places=2,
        help_text="單位：元。追加為正、減帳為負",
    )
    reason = models.TextField("變更原因")
    status = models.CharField(
        "狀態", max_length=10, choices=ChangeOrderStatus.choices, default=ChangeOrderStatus.DRAFT,
    )

    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, verbose_name="核准者",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="approved_change_orders",
    )
    approved_at = models.DateTimeField("核准時間", null=True, blank=True)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, verbose_name="建立者",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="created_change_orders",
    )
    created_at = models.DateTimeField("建立時間", auto_now_add=True)

    history = HistoricalRecords(table_name="projects_changeorder_history")

    class Meta:
        db_table = "projects_changeorder"
        verbose_name = verbose_name_plural = "變更追加單"
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["project", "status"])]

    def __str__(self):
        return f"{self.code} {self.title}"

    @property
    def is_approved(self):
        return self.status == ChangeOrderStatus.APPROVED

    @classmethod
    def generate_code(cls):
        year = timezone.localdate().year
        prefix = f"CO-{year}-"
        last = cls.objects.filter(code__startswith=prefix).order_by("-code").first()
        seq = int(last.code.rsplit("-", 1)[1]) + 1 if last else 1
        return f"{prefix}{seq:03d}"

    def save(self, *args, **kwargs):
        if not self.code:
            self.code = self.generate_code()
        super().save(*args, **kwargs)
