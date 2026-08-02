from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.utils.html import format_html

from .models import ActivityLog, Attachment, Department, Notification, SystemParameter, User


@admin.register(Department)
class DepartmentAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "parent", "manager", "is_active")
    list_filter = ("is_active",)
    search_fields = ("code", "name")
    ordering = ("sort_order", "code")


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ("username", "employee_no", "name", "department", "title", "role_list", "is_active")
    list_filter = ("is_active", "department", "groups")
    search_fields = ("username", "employee_no", "name", "phone")
    ordering = ("employee_no", "username")

    fieldsets = (
        (None, {"fields": ("username", "password")}),
        ("個人資料", {"fields": ("name", "employee_no", "department", "title", "phone", "email")}),
        ("角色與權限", {"fields": ("groups", "is_active", "is_staff", "is_superuser", "must_change_password")}),
        ("時間", {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = (
        (None, {
            "classes": ("wide",),
            "fields": ("username", "name", "employee_no", "password1", "password2", "groups"),
        }),
    )

    @admin.display(description="角色")
    def role_list(self, obj):
        return "、".join(obj.groups.values_list("name", flat=True)) or "—"

    def get_queryset(self, request):
        return super().get_queryset(request).select_related("department").prefetch_related("groups")


@admin.register(SystemParameter)
class SystemParameterAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "value", "unit", "effective_from", "effective_to", "updated_at")
    list_filter = ("code",)
    search_fields = ("code", "name", "source_note")
    ordering = ("code", "-effective_from")

    fieldsets = (
        (None, {"fields": ("code", "name", "value", "unit")}),
        ("生效期間", {
            "fields": ("effective_from", "effective_to"),
            "description": "⚠️ 帶生效日期是刻意的。手冊 13.5 把「費用率不更新」列為三大核算陷阱之一，"
                           "但更新後又不能讓歷史訂單的成本跟著變——2026 年的訂單必須用當年的費用率核算。"
                           "所以改參數時請<b>新增一筆</b>並設定新的生效日，不要直接改舊的那筆",
        }),
        ("依據", {"fields": ("source_note", "updated_by")}),
    )


@admin.register(Attachment)
class AttachmentAdmin(admin.ModelAdmin):
    list_display = ("original_name", "content_type", "object_id", "size_display",
                    "uploaded_by", "uploaded_at")
    list_filter = ("content_type", "uploaded_at")
    search_fields = ("original_name", "note")
    ordering = ("-uploaded_at",)
    readonly_fields = ("size_bytes", "mime_type", "uploaded_at")

    @admin.display(description="大小")
    def size_display(self, obj):
        return obj.size_display


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ("created_at", "recipient", "title", "category", "is_read", "dedup_key")
    list_filter = ("category", "is_read", "created_at")
    search_fields = ("title", "body", "recipient__name", "dedup_key")
    ordering = ("-created_at",)

    @admin.display(description="內容")
    def body_preview(self, obj):
        return format_html("<small>{}</small>", (obj.body or "")[:80])


@admin.register(ActivityLog)
class ActivityLogAdmin(admin.ModelAdmin):
    list_display = ("created_at", "category", "verb", "actor", "project")
    list_filter = ("category", "created_at")
    search_fields = ("verb", "actor__name", "project__name")
    ordering = ("-created_at",)
    readonly_fields = [f.name for f in ActivityLog._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
