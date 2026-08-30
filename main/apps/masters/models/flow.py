from django.db import models


class FlowTemplate(models.Model):
    """流程模板 —— 一份「這種案子要走哪些流程」的目錄（2026-08-29 D49）

    D37 起全公司只有一套 19 項目錄；D49 老闆要求可以有**好幾套**
    （標準案、小案、純土建案各一套），並且經理／系統管理員能在前端
    直接維護內容與新增模板——不再只能進 Django Admin。

    五大階段（FlowStage）仍是全公司共用的骨架；模板只決定
    「各階段底下放哪些工作項、預設順序與預設的工作內容」。
    改模板只影響**之後新建的案子**——已建案子的單元早就把內容抄走了。
    """

    name = models.CharField("名稱", max_length=50, unique=True)
    is_default = models.BooleanField(
        "預設模板", default=False, help_text="建案表單預先選中的那一套；全系統只有一套是預設",
    )
    is_active = models.BooleanField("啟用中", default=True)
    created_at = models.DateTimeField("建立時間", auto_now_add=True)

    class Meta:
        db_table = "masters_flowtemplate"
        verbose_name = verbose_name_plural = "流程模板"
        ordering = ["-is_default", "id"]

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        # 預設只有一套——把別套的預設旗標拿掉，不靠使用者記得去取消
        if self.is_default:
            FlowTemplate.objects.exclude(pk=self.pk).filter(is_default=True).update(
                is_default=False
            )

    @classmethod
    def default(cls):
        return cls.objects.filter(is_active=True).order_by("-is_default", "id").first()


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

    D49（2026-08-29）起工作項屬於某一套**流程模板**，順序是「模板的預設順序」：
    建案時抄進專案，之後每個案子可以自己增刪與拖移重排（順序存在 FlowUnit.seq）。
    D37 的「順序全域定死」規則由老闆本人翻案。
    """

    template = models.ForeignKey(
        FlowTemplate, verbose_name="流程模板", on_delete=models.CASCADE,
        related_name="items", null=True, blank=True,
        help_text="D49 之前的舊資料由資料遷移補上預設模板",
    )
    stage = models.ForeignKey(
        FlowStage, verbose_name="大階段", on_delete=models.PROTECT, related_name="items",
    )
    seq = models.SmallIntegerField("模板內順序", help_text="11,12,…,54，跨階段排序（模板內唯一）")
    code = models.CharField("代號", max_length=10, help_text="如 3.2（模板內唯一）")
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
            # D49：唯一性從全域改成「模板內」——不同模板可以各有自己的 3.2
            models.UniqueConstraint(fields=["template", "seq"], name="uniq_flowitem_template_seq"),
            models.UniqueConstraint(fields=["template", "code"], name="uniq_flowitem_template_code"),
        ]

    def __str__(self):
        return f"{self.code} {self.name}"
