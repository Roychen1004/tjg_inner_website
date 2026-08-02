from django.contrib import admin
from django.utils.html import format_html
from simple_history.admin import SimpleHistoryAdmin

from .models import Customer, Item, ItemCategory, Stage, StageTemplate, Vendor


@admin.register(Customer)
class CustomerAdmin(SimpleHistoryAdmin):
    list_display = ("code", "name", "tax_id", "contact_name", "contact_phone", "is_active")
    list_filter = ("is_active",)
    search_fields = ("code", "name", "tax_id", "contact_name")
    ordering = ("code",)


@admin.register(Vendor)
class VendorAdmin(SimpleHistoryAdmin):
    list_display = ("code", "name", "type_display", "tax_id", "contact_phone", "is_active")
    list_filter = ("is_active",)
    search_fields = ("code", "name", "tax_id")
    ordering = ("code",)
    fieldsets = (
        (None, {"fields": ("code", "name", "tax_id", "is_active")}),
        ("類型", {
            "fields": ("vendor_types",),
            "description": "可多選。同一家廠商可同時是供應商與外包加工廠——"
                           "不需要為了不同身分重複建檔",
        }),
        ("聯絡資訊", {"fields": ("contact_name", "contact_phone", "address")}),
        ("其他", {"fields": ("payment_terms", "note"), "classes": ("collapse",)}),
    )

    @admin.display(description="類型")
    def type_display(self, obj):
        return obj.type_display or "—"


class StageInline(admin.TabularInline):
    model = Stage
    extra = 0
    ordering = ("seq",)
    fields = (
        "seq", "code", "name", "color",
        "is_billing_trigger", "requires_signoff", "is_outsource", "is_hold", "is_core",
        "stall_days", "is_active",
    )


@admin.register(StageTemplate)
class StageTemplateAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "applies_to", "stage_count_display", "is_default", "is_active")
    list_filter = ("applies_to", "is_default", "is_active")
    search_fields = ("code", "name")
    inlines = [StageInline]
    fieldsets = (
        (None, {"fields": ("code", "name", "applies_to", "is_default", "is_active")}),
        ("說明", {
            "fields": ("note",),
            "description": format_html(
                "<b>階段旗標的意義</b><br>"
                "💰 <b>觸發請款</b>：此階段的完成條件達成時，對應請款里程碑轉「可請款」<br>"
                "✍ <b>需登錄簽收</b>：與「觸發請款」併用時，改為<b>登錄簽收後</b>才觸發，"
                "而非進入階段就觸發<br>"
                "🚚 <b>需填協力廠</b>：表單自動展開協力廠與進出廠日<br>"
                "⏸ <b>等待中</b>：不計入產能佔用（如置料區）<br>"
                "⚙ <b>核心加值</b>：工時計入 OEE 與加工成本<br><br>"
                "<b>停滯天數</b>：停留超過此天數列入「需要關注」。留空表示不檢查。"
            ),
        }),
    )

    @admin.display(description="階段數")
    def stage_count_display(self, obj):
        return obj.stage_count


@admin.register(Stage)
class StageAdmin(admin.ModelAdmin):
    list_display = ("template", "seq", "name", "flags_display", "stall_days", "is_active")
    list_filter = ("template", "is_billing_trigger", "requires_signoff", "is_active")
    search_fields = ("code", "name")
    ordering = ("template", "seq")

    @admin.display(description="旗標")
    def flags_display(self, obj):
        marks = [
            ("💰 觸發請款", obj.is_billing_trigger),
            ("✍ 需簽收", obj.requires_signoff),
            ("🚚 外包", obj.is_outsource),
            ("⏸ 等待", obj.is_hold),
            ("⚙ 核心", obj.is_core),
        ]
        return "　".join(label for label, on in marks if on) or "—"


@admin.register(ItemCategory)
class ItemCategoryAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "parent", "item_kind", "is_active")
    list_filter = ("item_kind", "is_active")
    search_fields = ("code", "name")
    ordering = ("item_kind", "sort_order", "code")


@admin.register(Item)
class ItemAdmin(SimpleHistoryAdmin):
    list_display = (
        "code", "name", "spec_label", "material_grade",
        "item_kind", "unit_of_measure", "unit_weight_kg", "is_active",
    )
    list_filter = ("item_kind", "tracking_mode", "profile_type", "material_grade", "is_active")
    search_fields = ("code", "name", "spec_label", "material_grade")
    ordering = ("item_kind", "code")
    autocomplete_fields = ("category", "preferred_vendor", "default_location")

    fieldsets = (
        (None, {
            "fields": ("code", "name", "category", "item_kind", "tracking_mode",
                       "unit_of_measure", "is_active"),
            "description": "<b>追蹤方式</b>：數量型用批號管（問「還剩多少」）；"
                           "個體型一物一筆有財產編號（問「在誰手上」）",
        }),
        ("規格（建材用）", {
            "fields": ("profile_type", "spec_label", "material_grade", "standard",
                       "surface_treatment", "requires_mill_cert"),
            "description": "選擇料型後，下方只需填該料型用得到的尺寸。"
                           "規格標示留空會依尺寸自動組出",
        }),
        ("尺寸", {
            "fields": ("thickness_mm", "width_mm", "height_mm", "length_mm",
                       "diameter_mm", "web_thickness_mm", "flange_thickness_mm"),
            "description": format_html(
                "<b>各料型需要的尺寸</b><br>"
                "鋼板：厚 × 寬 × 長<br>"
                "H型鋼：高 × 翼寬 × 腹板厚 × 翼板厚 × 長<br>"
                "角鋼：邊 × 邊 × 厚 × 長　｜　槽鋼：高 × 寬 × 厚<br>"
                "方管：邊 × 邊 × 厚 × 長　｜　圓管：外徑 × 厚 × 長<br>"
                "鋼筋：直徑 × 長　｜　螺栓：牙徑 × 長"
            ),
        }),
        ("重量與成本", {
            "fields": ("unit_weight_kg", "standard_cost", "preferred_vendor"),
            "description": "<b>單位重量</b>是鋼構論噸計價的基礎，"
                           "系統據此自動算總噸數、裝載率與分批請款金額",
        }),
        ("庫存管理", {"fields": ("default_location", "safety_stock"), "classes": ("collapse",)}),
        ("其他", {"fields": ("photo", "note"), "classes": ("collapse",)}),
    )

    def get_queryset(self, request):
        return super().get_queryset(request).select_related("category", "preferred_vendor")
