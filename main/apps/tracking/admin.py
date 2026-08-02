from django.contrib import admin
from django.utils.html import format_html
from simple_history.admin import SimpleHistoryAdmin

from main.utils.choices import STATUS_COLORS, UnitType

from .admin_actions import TrackingUnitActionsMixin
from .models import ProgressLog, TrackingUnit, TrackingUnitStageLog


class StageLogInline(admin.TabularInline):
    model = TrackingUnitStageLog
    extra = 0
    can_delete = False
    ordering = ("-moved_at",)
    fields = ("moved_at", "from_stage_name", "to_stage_name", "direction",
              "reason_category", "note", "moved_by")
    readonly_fields = fields

    def has_add_permission(self, request, obj=None):
        return False


class ProgressLogInline(admin.TabularInline):
    model = ProgressLog
    extra = 0
    can_delete = False
    ordering = ("-reported_at",)
    fields = ("reported_at", "qty_before", "qty_after", "pct_before", "pct_after",
              "delta", "note", "reported_by")
    readonly_fields = fields

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(TrackingUnit)
class TrackingUnitAdmin(TrackingUnitActionsMixin, SimpleHistoryAdmin):
    list_display = (
        "name", "project", "stage_display", "progress_display",
        "weight_display", "status_display", "signoff_display", "actions_display",
    )
    list_filter = ("unit_type", "status", "work_mode", "project", "current_stage")
    search_fields = ("code", "name", "project__name")
    ordering = ("project", "current_stage__seq")
    autocomplete_fields = ("project", "assignee", "subcontractor",
                           "outsource_vendor", "transport_vendor")
    inlines = [StageLogInline, ProgressLogInline]
    readonly_fields = ("code", "stage_entered_at", "rollback_count", "created_at", "updated_at")

    fieldsets = (
        (None, {
            "fields": ("code", "project", "phase", "unit_type", "name", "assignee", "status"),
        }),
        ("流程", {
            "fields": ("template", "current_stage", "stage_entered_at", "rollback_count"),
            "description": "階段推進請在前端操作——那裡會寫入歷程並觸發請款評估。"
                           "在此直接修改不會留下軌跡",
        }),
        ("進度（構件批次）", {
            "fields": ("qty_total", "qty_done", "unit_of_measure", "total_weight_kg"),
            "description": "<b>總重量</b>是分批請款與累計門檻的計算基準。"
                           "編輯權限限廠長／專案負責人／經營者",
        }),
        ("進度（土建工項）", {
            "fields": ("progress_pct", "subcontractor", "subcontract_amount"),
        }),
        ("外包", {
            "fields": ("work_mode", "outsource_vendor", "outsource_in_date",
                       "outsource_due_date", "outsource_out_date", "transport_vendor"),
            "classes": ("collapse",),
        }),
        ("進場簽收", {
            "fields": ("signoff_date", "signoff_by_name", "signoff_doc_no", "signoff_location"),
            "description": "⚠️ 登錄簽收會觸發請款評估，請在前端操作。"
                           "在此直接填寫不會產生請款事件",
        }),
        ("日期", {
            "fields": ("plan_start", "plan_end", "actual_start", "actual_end"),
            "classes": ("collapse",),
        }),
        ("其他", {"fields": ("note", "created_by", "created_at", "updated_at"),
                  "classes": ("collapse",)}),
    )

    @admin.display(description="目前階段")
    def stage_display(self, obj):
        stage = obj.current_stage
        marks = "".join([
            "💰" if stage.is_billing_trigger else "",
            "✍" if stage.requires_signoff else "",
            "🚚" if stage.is_outsource else "",
            "⏸" if stage.is_hold else "",
        ])
        stalled = " ⚠" if obj.is_stalled else ""
        return format_html(
            '<span style="color:{}">{}. {}</span>{}{}',
            stage.color, stage.seq, stage.name, marks, stalled,
        )

    @admin.display(description="進度")
    def progress_display(self, obj):
        ratio = obj.completion_ratio
        if obj.unit_type == UnitType.BATCH:
            detail = f"{obj.qty_done:g}/{obj.qty_total:g} {obj.unit_of_measure}"
        else:
            detail = f"{obj.progress_pct or 0:g}%"
        color = "#059669" if ratio >= 100 else "#2a78d6"
        return format_html(
            '<div style="min-width:110px">'
            '<div style="background:#e2e8f0;border-radius:4px;height:6px">'
            '<div style="background:{};width:{}%;height:6px;border-radius:4px"></div></div>'
            '<small>{}</small></div>',
            color, min(ratio, 100), detail,
        )

    @admin.display(description="重量")
    def weight_display(self, obj):
        if obj.total_weight_kg is None:
            return format_html('<span style="color:#94a3b8">未填</span>')
        return f"{obj.total_weight_kg / 1000:.2f} 噸"

    @admin.display(description="狀態")
    def status_display(self, obj):
        return format_html(
            '<span style="color:{};font-weight:600">● {}</span>',
            STATUS_COLORS.get(obj.status, "#64748b"), obj.get_status_display(),
        )

    @admin.display(description="簽收")
    def signoff_display(self, obj):
        if obj.signoff_date:
            return format_html(
                '<span style="color:#059669">✓ {}</span><br><small>{}</small>',
                obj.signoff_date, obj.signoff_by_name or "",
            )
        if obj.is_awaiting_signoff:
            return format_html(
                '<span style="color:#d97706;font-weight:600">待簽收 {} 天</span>',
                obj.days_in_stage,
            )
        return "—"

    def get_queryset(self, request):
        return super().get_queryset(request).select_related(
            "project", "current_stage", "assignee", "template",
        )


@admin.register(TrackingUnitStageLog)
class TrackingUnitStageLogAdmin(admin.ModelAdmin):
    list_display = ("moved_at", "unit", "from_stage_name", "to_stage_name",
                    "direction", "reason_category", "moved_by")
    list_filter = ("direction", "reason_category")
    search_fields = ("unit__name", "unit__code", "note")
    ordering = ("-moved_at",)
    readonly_fields = [f.name for f in TrackingUnitStageLog._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(ProgressLog)
class ProgressLogAdmin(admin.ModelAdmin):
    list_display = ("reported_at", "unit", "qty_before", "qty_after", "delta", "reported_by")
    search_fields = ("unit__name", "unit__code")
    ordering = ("-reported_at",)
    readonly_fields = [f.name for f in ProgressLog._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
