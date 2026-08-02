from django.db import models


class Department(models.Model):
    """部門（可階層）"""

    code = models.CharField("部門代號", max_length=20, unique=True)
    name = models.CharField("部門名稱", max_length=50)
    parent = models.ForeignKey(
        "self", verbose_name="上層部門", on_delete=models.SET_NULL,
        null=True, blank=True, related_name="children",
    )
    manager = models.ForeignKey(
        "core.User", verbose_name="部門主管", on_delete=models.SET_NULL,
        null=True, blank=True, related_name="managed_departments",
    )
    sort_order = models.SmallIntegerField("顯示順序", default=0)
    is_active = models.BooleanField("啟用中", default=True)

    class Meta:
        db_table = "core_department"
        verbose_name = verbose_name_plural = "部門"
        ordering = ["sort_order", "code"]

    def __str__(self):
        return self.name
