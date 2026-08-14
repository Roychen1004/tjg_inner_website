"""
core 模組的 API 路由

依 django_rules.md：<模組app>/<組件>/<元件>，結尾不加 "/"
"""
from django.urls import path

from .views import (
    AttachmentDetailView,
    AttachmentListView,
    ChangePasswordView,
    CsrfView,
    HealthView,
    LoginView,
    LogoutView,
    MeView,
    NotificationListView,
    NotificationReadView,
)

app_name = "core"

urlpatterns = [
    path("health", HealthView.as_view(), name="health"),

    path("auth/csrf", CsrfView.as_view(), name="csrf"),
    path("auth/login", LoginView.as_view(), name="login"),
    path("auth/logout", LogoutView.as_view(), name="logout"),
    path("auth/me", MeView.as_view(), name="me"),
    path("auth/change-password", ChangePasswordView.as_view(), name="change-password"),

    # 附件：權限借用母物件（?target=project&id=12），不是自己一套
    path("attachments", AttachmentListView.as_view(), name="attachments"),
    path("attachments/<int:pk>", AttachmentDetailView.as_view(), name="attachment-detail"),
    path("attachments/<int:pk>/download", AttachmentDetailView.as_view(), name="attachment-download"),

    path("notifications", NotificationListView.as_view(), name="notifications"),
    path("notifications/read", NotificationReadView.as_view(), name="notifications-read-all"),
    path("notifications/<int:pk>/read", NotificationReadView.as_view(), name="notification-read"),
]
