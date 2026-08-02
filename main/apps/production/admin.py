from django.contrib import admin
from django.utils.html import format_html

from main.utils.choices import LineStatus

from .models import ProductionLine

LINE_COLORS = {
    LineStatus.RUN: "#059669",
    LineStatus.CHANGEOVER: "#d97706",
    LineStatus.REPAIR: "#b91c1c",
    LineStatus.IDLE: "#94a3b8",
}


@admin.register(ProductionLine)
class ProductionLineAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "status_display", "utilization_display",
                    "current_work", "today_output", "is_active")
    list_filter = ("status", "is_active")
    search_fields = ("code", "name")
    ordering = ("sort_order", "code")

    fieldsets = (
        (None, {"fields": ("code", "name", "sort_order", "is_active")}),
        ("目前狀態", {
            "fields": ("status", "current_work", "utilization", "today_output"),
            "description": "P1 稼動率為人工填寫。P3 導入報工與 OEE 後改為自動計算（手冊第 17 章）",
        }),
    )

    @admin.display(description="狀態")
    def status_display(self, obj):
        return format_html(
            '<span style="color:{};font-weight:600">● {}</span>',
            LINE_COLORS.get(obj.status, "#64748b"), obj.get_status_display(),
        )

    @admin.display(description="稼動率")
    def utilization_display(self, obj):
        u = float(obj.utilization)
        color = "#059669" if u >= 75 else "#d97706" if u >= 55 else "#b91c1c"
        return format_html(
            '<div style="min-width:90px"><div style="background:#e2e8f0;border-radius:4px;height:6px">'
            '<div style="background:{};width:{}%;height:6px;border-radius:4px"></div></div>'
            '<small>{}%</small></div>', color, min(u, 100), f"{u:g}",
        )
