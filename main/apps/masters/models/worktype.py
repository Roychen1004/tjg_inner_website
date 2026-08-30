from django.db import models

from main.apps.core.models import TimeStampedModel


class WorkType(TimeStampedModel):
    """工作類型標籤（D52）——產能統計的分類基準

    焊接、切割、泥作……由經理維護，分配工作時**必選**一個。
    刻意獨立於流程目錄：同一種技能（焊接）會出現在不同流程裡，
    產能要照技能算，不是照流程算。
    """

    name = models.CharField("名稱", max_length=50, unique=True)
    is_active = models.BooleanField("啟用中", default=True)

    class Meta:
        db_table = "masters_worktype"
        verbose_name = verbose_name_plural = "工作類型"
        ordering = ["id"]

    def __str__(self):
        return self.name


class MaterialItem(TimeStampedModel):
    """品項主檔（D52）——材料平均單價的統計單位

    鋼材、螺栓、混凝土……應付款的明細列指到這裡，
    單價走勢與平均價按品項累積。登帳時可即時新增。
    """

    name = models.CharField("名稱", max_length=100, unique=True)
    unit_of_measure = models.CharField("計量單位", max_length=10, blank=True, help_text="噸、支、才……")
    is_active = models.BooleanField("啟用中", default=True)

    class Meta:
        db_table = "masters_materialitem"
        verbose_name = verbose_name_plural = "品項"
        ordering = ["name"]

    def __str__(self):
        return self.name
