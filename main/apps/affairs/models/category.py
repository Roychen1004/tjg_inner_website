from django.db import models

from main.apps.core.models import TimeStampedModel


class AffairCategory(TimeStampedModel):
    """行政類別（D53）——繳費、打掃、其他……

    經理與系統管理員維護；行政日曆上的色塊顏色跟著類別走。
    """

    name = models.CharField("名稱", max_length=50, unique=True)
    color = models.CharField(
        "顏色", max_length=7, default="#64748b", help_text="日曆色塊用，#RRGGBB",
    )
    is_active = models.BooleanField("啟用中", default=True)

    class Meta:
        db_table = "affairs_category"
        verbose_name = verbose_name_plural = "行政類別"
        ordering = ["id"]

    def __str__(self):
        return self.name
