from django.contrib import admin

from .models import KpiSnapshot


@admin.register(KpiSnapshot)
class KpiSnapshotAdmin(admin.ModelAdmin):
    list_display = ("kpi_code", "period_type", "period_start", "scope_type",
                    "value", "target_value", "status")
    list_filter = ("kpi_code", "period_type", "scope_type", "status")
    search_fields = ("kpi_code",)
    ordering = ("-period_start", "kpi_code")
    readonly_fields = [f.name for f in KpiSnapshot._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
