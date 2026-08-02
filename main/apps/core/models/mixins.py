"""共用的 model 基底"""
from django.db import models
from django.forms import ValidationError


class TimeStampedModel(models.Model):
    created_at = models.DateTimeField("建立時間", auto_now_add=True)
    updated_at = models.DateTimeField("更新時間", auto_now=True)

    class Meta:
        abstract = True


class ImmutableLogModel(models.Model):
    """不可變的歷程紀錄。

    階段歷程、進度回報、請款狀態異動都繼承這個——寫下去就不能改。
    這是可追溯性的基礎：歷程若能被竄改，就等於沒有歷程。

    只擋應用層的誤用；真要改資料庫還是改得掉，
    但那會留在稽核軌跡（django-simple-history）裡。
    """

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        if self.pk is not None:
            raise ValidationError(
                f"{self._meta.verbose_name}為不可變的歷程紀錄，不允許修改。"
                "若要更正，請新增一筆反向紀錄。"
            )
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError(f"{self._meta.verbose_name}為不可變的歷程紀錄，不允許刪除。")
