from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.db import models

from main.utils.choices import ActivityCategory


class ActivityLog(models.Model):
    """動態流水

    ⚠️ 這與稽核軌跡是兩回事：
      · ActivityLog  = 給人看的一句話，顯示在儀表板「最近動態」
      · 稽核軌跡      = 給查核用的欄位級變更紀錄，由 django-simple-history
                       自動產生 *_historical 表

    因此本表可以只保留兩年（決策 T12 相關），稽核軌跡保留七年。
    """

    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, verbose_name="操作者",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="activities",
        help_text="系統自動產生時為空",
    )
    verb = models.CharField(
        "描述", max_length=300,
        help_text="人類可讀的一句話，如「固越案·第一期-1F鋼柱 進入 進場簽收」",
    )
    category = models.CharField("類別", max_length=20, choices=ActivityCategory.choices)

    project = models.ForeignKey(
        "projects.Project", verbose_name="所屬專案",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="activities",
        help_text="用於資料可見範圍過濾",
    )
    content_type = models.ForeignKey(
        ContentType, on_delete=models.SET_NULL, null=True, blank=True, verbose_name="關聯類型",
    )
    object_id = models.BigIntegerField("關聯物件 ID", null=True, blank=True)
    content_object = GenericForeignKey("content_type", "object_id")

    created_at = models.DateTimeField("時間", auto_now_add=True, db_index=True)

    class Meta:
        db_table = "core_activitylog"
        verbose_name = verbose_name_plural = "動態"
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["project", "-created_at"])]

    def __str__(self):
        return self.verb

    @classmethod
    def record(cls, verb, category, actor=None, project=None, obj=None):
        kwargs = {"verb": verb, "category": category, "actor": actor, "project": project}
        if obj is not None:
            kwargs["content_type"] = ContentType.objects.get_for_model(obj)
            kwargs["object_id"] = obj.pk
        return cls.objects.create(**kwargs)
