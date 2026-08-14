from datetime import timedelta

from django.conf import settings
from django.db import models
from django.utils import timezone

from main.utils.choices import NotificationCategory


class NotificationQuerySet(models.QuerySet):
    def unread(self):
        return self.filter(is_read=False)

    def for_user(self, user):
        return self.filter(recipient=user)


class Notification(models.Model):
    """站內通知

    P1 不做即時推播（8GB 主機不養常駐服務，見決策 D05）——
    使用者開啟頁面時才載入。
    """

    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL, verbose_name="收件者",
        on_delete=models.CASCADE, related_name="notifications",
    )
    title = models.CharField("標題", max_length=200)
    body = models.TextField("內容", blank=True)
    link_url = models.CharField("跳轉路徑", max_length=500, blank=True)
    category = models.CharField(
        "類別", max_length=20, choices=NotificationCategory.choices,
        default=NotificationCategory.SYSTEM,
    )
    is_read = models.BooleanField("已讀", default=False)
    read_at = models.DateTimeField("讀取時間", null=True, blank=True)

    dedup_key = models.CharField(
        "去重鍵", max_length=150, blank=True, db_index=True,
        help_text="防止同一件事天天轟炸。格式如 alert:stalled:unit_130",
    )
    created_at = models.DateTimeField("建立時間", auto_now_add=True)

    objects = NotificationQuerySet.as_manager()

    class Meta:
        db_table = "core_notification"
        verbose_name = verbose_name_plural = "通知"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["recipient", "is_read", "-created_at"]),
            models.Index(fields=["dedup_key", "created_at"]),
        ]

    def __str__(self):
        return f"{self.recipient.name}：{self.title}"

    def mark_read(self):
        if not self.is_read:
            self.is_read = True
            self.read_at = timezone.now()
            self.save(update_fields=["is_read", "read_at"])

    @classmethod
    def send(cls, recipients, title, body="", link_url="", category=NotificationCategory.SYSTEM,
             dedup_key="", dedup_days=None):
        """建立通知，並依 dedup_key 避免重複轟炸。

        同一個 dedup_key 在 N 天內只發一次——某批次逾期五天，
        使用者不需要收到五則一模一樣的通知。
        """
        if dedup_key:
            window = dedup_days if dedup_days is not None else settings.NOTIFICATION_DEDUP_DAYS
            since = timezone.now() - timedelta(days=window)
            already = set(
                cls.objects.filter(dedup_key=dedup_key, created_at__gte=since)
                .values_list("recipient_id", flat=True)
            )
            recipients = [u for u in recipients if u.pk not in already]

        if not recipients:
            return []

        return cls.objects.bulk_create([
            cls(recipient=u, title=title, body=body, link_url=link_url,
                category=category, dedup_key=dedup_key)
            for u in recipients
        ])
