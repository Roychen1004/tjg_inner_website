from django.db import models


class FlowStage(models.Model):
    """流程大階段 —— 全公司只有一套（docs/鋼構專案流程.md 的五大階段）

    2026-08-14 流程制改版：不再分土建／鋼構兩套模板。
    土建案、小案＝建案時勾比較少的流程，不是走另一條流程。
    """

    seq = models.SmallIntegerField("順序", unique=True, help_text="1 起算")
    code = models.CharField("代號", max_length=10, unique=True, help_text="s1..s5")
    name = models.CharField("名稱", max_length=30)
    gate = models.CharField(
        "出口門檻", max_length=100, blank=True,
        help_text="跨過這個階段時必須存在的產出物，如「報價依據圖定版」",
    )
    is_active = models.BooleanField("啟用中", default=True)

    class Meta:
        db_table = "masters_flowstage"
        verbose_name = verbose_name_plural = "流程大階段"
        ordering = ["seq"]

    def __str__(self):
        return f"{self.seq} {self.name}"


class FlowItem(models.Model):
    """流程工作項 —— 大階段底下的一格（如 3.2 施工圖／加工圖繪製）

    ★ 順序在這裡定死（seq 全域唯一遞增），任何專案都不能重排——
    「訂料與採購一定排在施工放樣收點後面」是目錄的責任，不是使用者的選項。
    專案能做的只有「勾或不勾」。
    """

    stage = models.ForeignKey(
        FlowStage, verbose_name="大階段", on_delete=models.PROTECT, related_name="items",
    )
    seq = models.SmallIntegerField("全域順序", unique=True, help_text="11,12,…,54，跨階段全域排序")
    code = models.CharField("代號", max_length=10, unique=True, help_text="如 3.2")
    name = models.CharField("名稱", max_length=50)

    description = models.TextField("工作內容", blank=True)
    deliverables = models.TextField("產出物", blank=True, help_text="一行一項，附件上傳的檢核參考")
    done_criteria = models.CharField("完成條件", max_length=200, blank=True)

    is_gate = models.BooleanField(
        "硬門檻", default=False, help_text="如 3.3 業主圖面簽認——未過不得下料加工",
    )
    batch_stage_seq = models.SmallIntegerField(
        "批次彙總門檻站序", null=True, blank=True,
        help_text="階段 4 專用：構件批次走過此站序（含）即算進本流程的完成數。"
                  "填了此欄且專案有批次時，進度由批次自動彙總，不手填",
    )
    is_active = models.BooleanField("啟用中", default=True)

    class Meta:
        db_table = "masters_flowitem"
        verbose_name = verbose_name_plural = "流程工作項"
        ordering = ["seq"]
        constraints = [
            models.CheckConstraint(condition=models.Q(seq__gte=1), name="ck_flowitem_seq_positive"),
        ]

    def __str__(self):
        return f"{self.code} {self.name}"
