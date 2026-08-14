from django.contrib.auth.models import AbstractUser
from django.db import models


class Role(models.TextChoices):
    """角色代號。對應 Django Group 的 name，一個使用者可掛多個，權限取聯集。

    只有三種——實際天天用系統的是經營者與會計兩個人（2026-08-13 確認）。
    「檢視」給未來想讓同仁看進度用：看得到案子與進度，看不到任何金額。
    角色種類比使用者還多的權限矩陣，只是把簡單的事變難。
    """

    OWNER = "owner", "經營者"
    FINANCE = "finance", "會計"
    VIEWER = "viewer", "檢視"


class User(AbstractUser):
    """使用者（擴充 Django AbstractUser）"""

    employee_no = models.CharField("員工編號", max_length=20, unique=True, null=True, blank=True)
    name = models.CharField("姓名", max_length=50)
    department = models.ForeignKey(
        "core.Department", verbose_name="所屬部門", on_delete=models.SET_NULL,
        null=True, blank=True, related_name="members",
    )
    title = models.CharField("職稱", max_length=50, blank=True)
    phone = models.CharField("手機", max_length=20, blank=True)
    must_change_password = models.BooleanField("需修改密碼", default=True)

    # AbstractUser 的 first_name / last_name 對中文姓名沒有意義，改用 name
    first_name = None
    last_name = None

    class Meta:
        db_table = "core_user"
        verbose_name = verbose_name_plural = "使用者"
        ordering = ["employee_no", "username"]
        indexes = [
            models.Index(fields=["is_active"]),
            models.Index(fields=["department"]),
        ]

    def __str__(self):
        return f"{self.name}（{self.username}）"

    def get_full_name(self):
        return self.name

    def get_short_name(self):
        return self.name

    # ── 角色 ───────────────────────────────────────────────────────
    @property
    def role_codes(self):
        if not hasattr(self, "_role_codes"):
            self._role_codes = set(self.groups.values_list("name", flat=True))
        return self._role_codes

    def has_role(self, *codes):
        """是否具備其中任一角色。superuser 一律視為具備所有角色。"""
        if self.is_superuser:
            return True
        return bool(self.role_codes & set(codes))

    @property
    def default_route(self) -> str:
        return "/dashboard"
