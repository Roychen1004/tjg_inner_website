from django.contrib import admin
from simple_history.admin import SimpleHistoryAdmin

from .models import BillingMilestone, MilestoneLog


class MilestoneLogInline(admin.TabularInline):
    model = MilestoneLog
    extra = 0
    can_delete = False
    readonly_fields = ("from_state", "to_state", "reason", "amount_snapshot", "changed_by", "changed_at")

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(BillingMilestone)
class BillingMilestoneAdmin(SimpleHistoryAdmin):
    list_display = ("project", "seq", "label", "percentage", "amount", "state", "expected_date")
    list_filter = ("state", "project")
    search_fields = ("label", "project__name", "invoice_no")
    autocomplete_fields = ("project",)
    inlines = [MilestoneLogInline]

    def get_queryset(self, request):
        return super().get_queryset(request).select_related("project")
