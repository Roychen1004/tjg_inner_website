from django.contrib import admin
from django.utils.html import format_html
from simple_history.admin import SimpleHistoryAdmin

from .models import Customer, FlowItem, FlowStage, Stage, StageTemplate, Vendor


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
    fields = ("seq", "code", "name", "color", "stall_days", "is_active")


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
                "<b>停滯天數</b>：停留超過此天數列入「需要關注」。留空表示不檢查。"
            ),
        }),
    )

    @admin.display(description="階段數")
    def stage_count_display(self, obj):
        return obj.stage_count


@admin.register(Stage)
class StageAdmin(admin.ModelAdmin):
    list_display = ("template", "seq", "name", "stall_days", "is_active")
    list_filter = ("template", "is_active")
    search_fields = ("code", "name")
    ordering = ("template", "seq")


# ── 流程目錄（2026-08-14 流程制改版）────────────────────────────────
class FlowItemInline(admin.TabularInline):
    model = FlowItem
    extra = 0
    ordering = ("seq",)
    fields = ("seq", "code", "name", "done_criteria", "is_gate", "batch_stage_seq", "is_active")


@admin.register(FlowStage)
class FlowStageAdmin(admin.ModelAdmin):
    list_display = ("seq", "name", "gate", "is_active")
    ordering = ("seq",)
    inlines = [FlowItemInline]


@admin.register(FlowItem)
class FlowItemAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "stage", "seq", "is_gate", "batch_stage_seq", "is_active")
    list_filter = ("stage", "is_active")
    search_fields = ("code", "name")
    ordering = ("seq",)



