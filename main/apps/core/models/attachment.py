import uuid
from pathlib import Path

from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

from main.utils.choices import AttachmentCategory

#: 可在瀏覽器裡直接看的格式。其餘一律明說要下載——
#: 按了才跳出「無法預覽」比一開始就講清楚更糟（決策 D30）。
PREVIEWABLE_MIME = frozenset({"application/pdf", "image/jpeg", "image/png"})


def attachment_upload_path(instance, filename):
    """存檔路徑：attachments/YYYY/MM/<uuid>.<ext>

    刻意不用原始檔名——中文檔名在不同系統會亂碼，同名檔案也會互相覆蓋，
    而且原始檔名進了路徑就等於把使用者輸入放進檔案系統（`../` 之類）。
    原始檔名另外存在欄位裡，下載時再還原。
    """
    ext = Path(filename).suffix.lower().lstrip(".")[:10]
    now = timezone.localdate()
    return f"attachments/{now:%Y/%m}/{uuid.uuid4().hex}{'.' + ext if ext else ''}"


class Attachment(models.Model):
    """泛用附件（可掛在任何物件上）

    檔案本體存在檔案系統，資料庫只存路徑——大檔塞進 DB 會拖垮備份。
    下載一律經 Django 檢查權限後用 X-Accel-Redirect 交給 nginx（決策 T11），
    不可讓 nginx 直接服務，否則任何人拿到 URL 就能下載合約。

    ⚠️ **副檔名不能信。** `clean()` 擋得住手滑，擋不住惡意——
    把 evil.html 改名成 photo.jpg 就過了。真正的類型檢查讀 magic bytes，
    在 `core/services/attachment_service.py`。
    """

    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE, verbose_name="關聯類型")
    object_id = models.BigIntegerField("關聯物件 ID")
    content_object = GenericForeignKey("content_type", "object_id")

    file = models.FileField("檔案", upload_to=attachment_upload_path, max_length=300)
    original_name = models.CharField("原始檔名", max_length=255)
    size_bytes = models.BigIntegerField("檔案大小")
    mime_type = models.CharField("MIME 類型", max_length=100, blank=True)
    note = models.CharField("備註", max_length=200, blank=True)

    category = models.CharField(
        "分類", max_length=20, choices=AttachmentCategory.choices,
        default=AttachmentCategory.OTHER,
        help_text="一個案子底下可能有二十個檔案。沒有分類就是一坨清單，"
                  "「合約在哪」會變成一次搜尋而不是一次點擊",
    )
    is_previewable = models.BooleanField(
        "可預覽", default=False,
        help_text="上傳時依**實際** MIME 判定，前端不必再從副檔名猜",
    )
    checksum = models.CharField(
        "SHA-256", max_length=64, blank=True, db_index=True,
        help_text="同一份合約被傳兩次時看得出來；日後也可用於完整性驗證",
    )

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
        size = float(self.size_bytes or 0)
        for unit in ("B", "KB", "MB", "GB"):
            if size < 1024:
                return f"{size:.1f} {unit}"
            size /= 1024
        return f"{size:.1f} TB"

    @property
    def ext(self):
        return Path(self.original_name or "").suffix.lower().lstrip(".")

    def clean(self):
        if self.size_bytes and self.size_bytes > settings.MAX_UPLOAD_SIZE:
            raise ValidationError(
                f"檔案大小 {self.size_display} 超過上限 {settings.MAX_UPLOAD_SIZE_MB}MB"
            )
        if self.ext and self.ext not in settings.ALLOWED_UPLOAD_EXTENSIONS:
            allowed = "、".join(settings.ALLOWED_UPLOAD_EXTENSIONS)
            raise ValidationError(f"不支援的檔案類型「{self.ext}」。僅接受：{allowed}")

    def delete(self, *args, **kwargs):
        """刪 DB 列時一併刪掉磁碟上的檔案。

        不這樣做，磁碟上會累積沒有任何列指向的孤兒檔案——
        備份時間持續變長，而且沒有人知道那些檔案是誰的、能不能刪。
        """
        stored = self.file
        super().delete(*args, **kwargs)
        stored.delete(save=False)
