from django.contrib import admin
from django.utils.html import format_html
from simple_history.admin import SimpleHistoryAdmin

from main.utils.choices import STATUS_COLORS

from .models import ChangeOrder, Project, ProjectPhase


class ProjectPhaseInline(admin.TabularInline):
    model = ProjectPhase
    extra = 0
    ordering = ("seq",)


@admin.register(Project)
class ProjectAdmin(SimpleHistoryAdmin):
    list_display = (
        "code", "name", "project_type", "customer", "amount_display",
        "main_stage", "status_display", "collection_display", "due_display",
    )
    list_filter = ("project_type", "status", "is_closed", "customer")
    search_fields = ("code", "name", "customer__name")
    ordering = ("-created_at",)
    autocomplete_fields = ("customer", "owner")
    inlines = [ProjectPhaseInline]
    readonly_fields = ("code", "created_at", "updated_at")

    fieldsets = (
        (None, {
            "fields": ("code", "name", "project_type", "customer", "owner",
                       "contract_amount", "status", "is_closed"),
        }),
        ("工期", {"fields": ("start_date", "due_date", "actual_end_date")}),
        ("流程", {
            "fields": ("main_template", "main_stage"),
            "description": "主線階段的推進請在前端操作——那裡會寫入歷程紀錄。"
                           "在此直接修改不會留下異動軌跡",
        }),
        ("合約與文件", {
            "fields": ("contract_terms", "quote_info", "doc_links", "note"),
            "classes": ("collapse",),
        }),
        ("系統", {"fields": ("created_by", "created_at", "updated_at"), "classes": ("collapse",)}),
    )

    @admin.display(description="合約額")
    def amount_display(self, obj):
        if obj.contract_amount is None:
            return format_html('<span style="color:#94a3b8">金額待確認</span>')
        effective = obj.effective_amount
        if effective != obj.contract_amount:
            return format_html(
                "{:,.0f}<br><small style='color:#0891b2'>有效 {:,.0f}</small>",
                obj.contract_amount, effective,
            )
        return f"{obj.contract_amount:,.0f}"

    @admin.display(description="狀態")
    def status_display(self, obj):
        return format_html(
            '<span style="color:{};font-weight:600">● {}</span>',
            STATUS_COLORS.get(obj.status, "#64748b"), obj.get_status_display(),
        )

    @admin.display(description="收攏率")
    def collection_display(self, obj):
        rate = obj.collection_rate
        if rate is None:
            return "—"
        color = "#059669" if rate >= 60 else "#d97706" if rate >= 30 else "#b91c1c"
        return format_html('<span style="color:{}">{}%</span>', color, rate)

    @admin.display(description="預計完工")
    def due_display(self, obj):
        if not obj.due_date:
            return "—"
        if obj.is_overdue:
            return format_html('<span style="color:#b91c1c;font-weight:600">{} 逾期</span>', obj.due_date)
        return obj.due_date

    def get_queryset(self, request):
        return super().get_queryset(request).select_related(
            "customer", "owner", "main_stage"
        ).prefetch_related("change_orders", "milestones")


@admin.register(ProjectPhase)
class ProjectPhaseAdmin(admin.ModelAdmin):
    list_display = ("project", "seq", "name")
    list_filter = ("project",)
    search_fields = ("name", "project__name")
    ordering = ("project", "seq")


@admin.register(ChangeOrder)
class ChangeOrderAdmin(SimpleHistoryAdmin):
    list_display = ("code", "project", "title", "amount_display", "status", "approved_by", "approved_at")
    list_filter = ("status", "project")
    search_fields = ("code", "title", "project__name")
    ordering = ("-created_at",)
    autocomplete_fields = ("project",)
    readonly_fields = ("code", "created_at")

    fieldsets = (
        (None, {
            "fields": ("code", "project", "title", "amount", "reason", "status"),
            "description": "⚠️ 只有狀態為「已核准」才計入有效合約額，"
                           "並連帶重算所有請款里程碑金額。"
                           "核准請在前端操作，那裡會一併處理重算與通知",
        }),
        ("核准", {"fields": ("approved_by", "approved_at")}),
        ("系統", {"fields": ("created_by", "created_at"), "classes": ("collapse",)}),
    )

    @admin.display(description="變更金額")
    def amount_display(self, obj):
        color = "#059669" if obj.amount >= 0 else "#b91c1c"
        return format_html('<span style="color:{}">{:+,.0f}</span>', color, obj.amount)
