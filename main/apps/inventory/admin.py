from django.contrib import admin
from django.utils.html import format_html
from simple_history.admin import SimpleHistoryAdmin

from main.utils.choices import AgingStatus, LocationType

from .models import Location, Lot, StockTransaction

AGING_COLORS = {
    AgingStatus.NORMAL: "#059669",
    AgingStatus.SLOW: "#0891b2",
    AgingStatus.STAGNANT: "#d97706",
    AgingStatus.DEAD: "#ea580c",
    AgingStatus.SCRAP_CANDIDATE: "#b91c1c",
}


@admin.register(Location)
class LocationAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "location_type", "parent", "link_display", "is_active")
    list_filter = ("location_type", "is_active")
    search_fields = ("code", "name")
    ordering = ("location_type", "code")
    autocomplete_fields = ("parent", "project", "vendor")

    fieldsets = (
        (None, {"fields": ("code", "name", "location_type", "parent", "is_active")}),
        ("關聯", {
            "fields": ("project", "vendor"),
            "description": "類型為<b>工地</b>時必須指定專案，"
                           "類型為<b>外包廠</b>時必須指定廠商。<br>"
                           "這讓「料已進場」與「料在協力廠」變成可查詢的事實——"
                           "送外包的料不會像傳統系統那樣「已出庫」等於消失",
        }),
        ("其他", {"fields": ("capacity_note",), "classes": ("collapse",)}),
    )

    @admin.display(description="關聯對象")
    def link_display(self, obj):
        if obj.location_type == LocationType.SITE and obj.project:
            return format_html('<span style="color:#2a78d6">🏗 {}</span>', obj.project.name)
        if obj.location_type == LocationType.VENDOR and obj.vendor:
            return format_html('<span style="color:#ea580c">🚚 {}</span>', obj.vendor.name)
        return "—"


@admin.register(Lot)
class LotAdmin(SimpleHistoryAdmin):
    list_display = (
        "lot_no", "item", "spec_display", "qty_display", "weight_display",
        "status", "location", "project_display", "aging_display", "remnant_display",
    )
    list_filter = ("status", "aging_status", "is_remnant", "location", "item__item_kind")
    search_fields = ("lot_no", "item__name", "item__code", "item__spec_label",
                     "heat_no", "mill_cert_no")
    ordering = ("item", "lot_no")
    autocomplete_fields = ("item", "location", "reserved_for_project", "parent_lot")
    readonly_fields = ("aging_status",)

    fieldsets = (
        (None, {"fields": ("lot_no", "item", "location", "status")}),
        ("數量與價值", {"fields": ("qty_on_hand", "qty_reserved", "unit_cost", "total_value")}),
        ("專案歸屬", {"fields": ("reserved_for_project",)}),
        ("追溯", {
            "fields": ("received_date", "last_move_date", "aging_status",
                       "source_po_no", "mill_cert_no", "heat_no"),
        }),
        ("餘料", {
            "fields": ("is_remnant", "parent_lot", "actual_length_mm", "actual_width_mm"),
            "description": "切割後的料頭仍然值錢，且直接影響材料利用率 KPI（目標 85%）。"
                           "記錄實際剩餘尺寸後，「找料」功能才媒合得到，避免開新料",
        }),
        ("其他", {"fields": ("note",), "classes": ("collapse",)}),
    )

    @admin.display(description="規格")
    def spec_display(self, obj):
        return obj.item.spec_label or "—"

    @admin.display(description="數量")
    def qty_display(self, obj):
        if obj.qty_reserved:
            return format_html(
                "{:g} {}<br><small style='color:#d97706'>預留 {:g}</small>",
                obj.qty_on_hand, obj.item.unit_of_measure, obj.qty_reserved,
            )
        return f"{obj.qty_on_hand:g} {obj.item.unit_of_measure}"

    @admin.display(description="重量")
    def weight_display(self, obj):
        w = obj.total_weight_kg
        return f"{w / 1000:.2f} 噸" if w else "—"

    @admin.display(description="預留給")
    def project_display(self, obj):
        return obj.reserved_for_project.name if obj.reserved_for_project else "—"

    @admin.display(description="庫齡")
    def aging_display(self, obj):
        return format_html(
            '<span style="color:{}">{}（{} 天）</span>',
            AGING_COLORS.get(obj.aging_status, "#64748b"),
            obj.get_aging_status_display(), obj.aging_days,
        )

    @admin.display(description="餘料")
    def remnant_display(self, obj):
        if not obj.is_remnant:
            return "—"
        dims = []
        if obj.actual_length_mm:
            dims.append(f"L{obj.actual_length_mm:g}")
        if obj.actual_width_mm:
            dims.append(f"W{obj.actual_width_mm:g}")
        return format_html('<span style="color:#0891b2">✂ {}</span>', " × ".join(dims) or "是")

    def get_queryset(self, request):
        return super().get_queryset(request).select_related(
            "item", "location", "reserved_for_project"
        )


@admin.register(StockTransaction)
class StockTransactionAdmin(admin.ModelAdmin):
    list_display = ("occurred_at", "lot", "txn_type", "qty", "qty_after",
                    "project", "tracking_unit", "operator")
    list_filter = ("txn_type", "occurred_at")
    search_fields = ("lot__lot_no", "ref_doc_no", "project__name")
    ordering = ("-occurred_at",)
    readonly_fields = [f.name for f in StockTransaction._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def get_queryset(self, request):
        return super().get_queryset(request).select_related(
            "lot", "project", "tracking_unit", "operator"
        )
