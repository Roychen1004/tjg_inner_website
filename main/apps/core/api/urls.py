"""
core 模組的 API 路由

依 django_rules.md：<模組app>/<組件>/<元件>，結尾不加 "/"
"""
from django.urls import path

from .views import (
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

    path("notifications", NotificationListView.as_view(), name="notifications"),
    path("notifications/read", NotificationReadView.as_view(), name="notifications-read-all"),
    path("notifications/<int:pk>/read", NotificationReadView.as_view(), name="notification-read"),
]
