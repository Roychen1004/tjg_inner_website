from django.contrib import admin
from simple_history.admin import SimpleHistoryAdmin

from .models import FlowTask, FlowTaskAssignment, FlowUnit, ProgressLog, TrackingUnit, TrackingUnitStageLog


class FlowTaskInline(admin.TabularInline):
    model = FlowTask
    extra = 0


@admin.register(FlowTaskAssignment)
class FlowTaskAssignmentAdmin(admin.ModelAdmin):
    list_display = ("task", "status", "assignee", "qty_assigned", "qty_done")
    search_fields = ("task__name", "assignee__name", "status")

    def get_queryset(self, request):
        return super().get_queryset(request).select_related("task__unit__project", "assignee")


@admin.register(FlowUnit)
class FlowUnitAdmin(SimpleHistoryAdmin):
    list_display = ("project", "flow_item", "state", "assignee", "plan_start", "plan_end")
    list_filter = ("state", "flow_item__stage")
    search_fields = ("project__name", "flow_item__name", "assignee__name")
    autocomplete_fields = ("project", "assignee", "subcontractor")
    inlines = [FlowTaskInline]

    def get_queryset(self, request):
        return super().get_queryset(request).select_related(
            "project", "flow_item__stage", "assignee"
        )


class StageLogInline(admin.TabularInline):
    model = TrackingUnitStageLog
    extra = 0
    can_delete = False
    readonly_fields = (
        "from_stage_name", "to_stage_name", "direction", "note",
        "qty_at_exit", "pct_at_exit", "moved_by", "moved_at",
    )

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(TrackingUnit)
class TrackingUnitAdmin(SimpleHistoryAdmin):
    list_display = ("code", "project", "name", "unit_type", "current_stage", "status")
    list_filter = ("unit_type", "status", "template")
    search_fields = ("code", "name", "project__name")
    autocomplete_fields = ("project", "subcontractor")
    inlines = [StageLogInline]

    def get_queryset(self, request):
        return super().get_queryset(request).select_related("project", "current_stage")


@admin.register(ProgressLog)
class ProgressLogAdmin(admin.ModelAdmin):
    list_display = ("unit", "delta", "note", "reported_by", "reported_at")
    readonly_fields = [f.name for f in ProgressLog._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
