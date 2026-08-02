import uuid
from pathlib import Path

from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import ValidationError
from django.db import models


def attachment_upload_path(instance, filename):
    """存檔路徑：attachments/YYYY/MM/<uuid>.<ext>

    刻意不用原始檔名——中文檔名在不同系統會亂碼，
    同名檔案也會互相覆蓋。原始檔名另外存在欄位裡供下載時還原。
    """
    ext = Path(filename).suffix.lower().lstrip(".")
    return f"attachments/%Y/%m/{uuid.uuid4().hex}.{ext}".replace(
        "%Y/%m", instance.uploaded_at.strftime("%Y/%m") if instance.uploaded_at else "unsorted"
    )


class Attachment(models.Model):
    """泛用附件（可掛在任何物件上）

    檔案本體存在檔案系統，資料庫只存路徑——大檔塞進 DB 會拖垮備份。
    下載一律經 Django 檢查權限後用 X-Accel-Redirect 交給 nginx（決策 T11），
    不可讓 nginx 直接服務，否則任何人拿到 URL 就能下載合約。
    """

    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE, verbose_name="關聯類型")
    object_id = models.BigIntegerField("關聯物件 ID")
    content_object = GenericForeignKey("content_type", "object_id")

    file = models.FileField("檔案", upload_to="attachments/%Y/%m/", max_length=300)
    original_name = models.CharField("原始檔名", max_length=255)
    size_bytes = models.BigIntegerField("檔案大小")
    mime_type = models.CharField("MIME 類型", max_length=100, blank=True)
    note = models.CharField("備註", max_length=200, blank=True)

    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, verbose_name="上傳者",
        on_delete=models.SET_NULL, null=True, related_name="uploaded_attachments",
    )
    uploaded_at = models.DateTimeField("上傳時間", auto_now_add=True)

    class Meta:
        db_table = "core_attachment"
        verbose_name = verbose_name_plural = "附件"
        ordering = ["-uploaded_at"]
        indexes = [models.Index(fields=["content_type", "object_id"])]

    def __str__(self):
        return self.original_name

    @property
    def size_display(self):
        size = self.size_bytes
        for unit in ("B", "KB", "MB", "GB"):
            if size < 1024:
                return f"{size:.1f} {unit}"
            size /= 1024
        return f"{size:.1f} TB"

    def clean(self):
        if self.size_bytes and self.size_bytes > settings.MAX_UPLOAD_SIZE:
            raise ValidationError(
                f"檔案大小 {self.size_display} 超過上限 {settings.MAX_UPLOAD_SIZE_MB}MB"
            )
        ext = Path(self.original_name or "").suffix.lower().lstrip(".")
        if ext and ext not in settings.ALLOWED_UPLOAD_EXTENSIONS:
            allowed = "、".join(settings.ALLOWED_UPLOAD_EXTENSIONS)
            raise ValidationError(f"不支援的檔案類型「{ext}」。僅接受：{allowed}")
