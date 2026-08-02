from django.contrib import admin
from django.utils.html import format_html
from simple_history.admin import SimpleHistoryAdmin

from main.utils.choices import AssetStatus

from .models import AssetMovement, AssetUnit

STATUS_COLORS = {
    AssetStatus.IDLE: "#059669",
    AssetStatus.IN_USE: "#2a78d6",
    AssetStatus.LENT: "#0891b2",
    AssetStatus.MAINTENANCE: "#d97706",
    AssetStatus.CALIBRATION: "#d97706",
    AssetStatus.SCRAPPED: "#64748b",
    AssetStatus.LOST: "#b91c1c",
}


class AssetMovementInline(admin.TabularInline):
    model = AssetMovement
    extra = 0
    can_delete = False
    ordering = ("-occurred_at",)
    fields = ("occurred_at", "movement_type", "from_location", "to_location",
              "from_holder", "to_holder", "to_project", "operator")
    readonly_fields = fields

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(AssetUnit)
class AssetUnitAdmin(SimpleHistoryAdmin):
    list_display = ("asset_no", "item", "brand_model", "status_display",
                    "location", "holder", "current_project", "due_display")
    list_filter = ("asset_status", "item__item_kind", "location", "is_active")
    search_fields = ("asset_no", "serial_no", "item__name", "brand", "model")
    ordering = ("asset_no",)
    autocomplete_fields = ("item", "location", "holder", "current_project")
    inlines = [AssetMovementInline]

    fieldsets = (
        (None, {"fields": ("asset_no", "item", "serial_no", "brand", "model", "is_active")}),
        ("目前狀態", {
            "fields": ("asset_status", "location", "holder", "current_project"),
            "description": "派用與歸還請在前端操作——那裡會寫入異動歷程",
        }),
        ("資產資訊", {
            "fields": ("purchase_date", "purchase_cost", "depreciation_years", "book_value"),
            "classes": ("collapse",),
        }),
        ("保養與校驗", {
            "fields": ("last_maintenance_date", "next_maintenance_date", "calibration_due_date"),
            "description": "扭力扳手、量具、吊帶、吊具等需定期校驗。到期前 14 天會自動提醒",
        }),
        ("其他", {"fields": ("photo", "note"), "classes": ("collapse",)}),
    )

    @admin.display(description="廠牌型號")
    def brand_model(self, obj):
        return " ".join(filter(None, [obj.brand, obj.model])) or "—"

    @admin.display(description="狀態")
    def status_display(self, obj):
        return format_html(
            '<span style="color:{};font-weight:600">● {}</span>',
            STATUS_COLORS.get(obj.asset_status, "#64748b"), obj.get_asset_status_display(),
        )

    @admin.display(description="到期提醒")
    def due_display(self, obj):
        alerts = []
        if obj.calibration_due_date:
            color = "#b91c1c" if obj.is_calibration_overdue else "#d97706"
            alerts.append(f'<span style="color:{color}">校驗 {obj.calibration_due_date}</span>')
        if obj.next_maintenance_date:
            color = "#b91c1c" if obj.is_maintenance_overdue else "#64748b"
            alerts.append(f'<span style="color:{color}">保養 {obj.next_maintenance_date}</span>')
        return format_html("<br>".join(alerts)) if alerts else "—"

    def get_queryset(self, request):
        return super().get_queryset(request).select_related(
            "item", "location", "holder", "current_project"
        )


@admin.register(AssetMovement)
class AssetMovementAdmin(admin.ModelAdmin):
    list_display = ("occurred_at", "asset", "movement_type", "from_holder",
                    "to_holder", "to_project", "operator")
    list_filter = ("movement_type",)
    search_fields = ("asset__asset_no", "asset__item__name")
    ordering = ("-occurred_at",)
    readonly_fields = [f.name for f in AssetMovement._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
