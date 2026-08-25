from django.contrib.auth.models import AbstractUser
from django.db import models


class Role(models.TextChoices):
    """角色代號。對應 Django Group 的 name，一個使用者可掛多個，權限取聯集。

    四種（2026-08-18 D40 依老闆指示重訂標籤與權限）：
      經理 —— 什麼都看得到、什麼都能改（系統管理員＝superuser，權限相同）
      會計師 —— 什麼頁面都看得到，只能改金流與自己的任務
      員工 —— 繪圖師、行政人員、工廠員工：除金流外都看得到（唯讀、無金額），
              只能動「我的任務」裡指派給自己的單元
      檢視 —— 備用：同員工的唯讀範圍，但不會被指派任務
    """

    OWNER = "owner", "經理"
    FINANCE = "finance", "會計師"
    STAFF = "staff", "員工"
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
        """登入後落地頁。員工的世界是「我的任務」，不是全公司總覽。"""
        if self.has_role(Role.OWNER, Role.FINANCE, Role.VIEWER):
            return "/dashboard"
        if self.has_role(Role.STAFF):
            return "/mywork"
        return "/dashboard"
