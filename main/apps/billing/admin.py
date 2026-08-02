from django.contrib import admin
from django.utils.html import format_html
from simple_history.admin import SimpleHistoryAdmin

from main.utils.choices import MilestoneState, TriggerType

from .models import BillingClaim, BillingClaimLog, BillingMilestone

STATE_COLORS = {
    MilestoneState.PENDING: "#64748b",
    MilestoneState.CLAIMABLE: "#d97706",
    MilestoneState.PARTIAL: "#0891b2",
    MilestoneState.INVOICED: "#2a78d6",
    MilestoneState.RECEIVED: "#059669",
}


class BillingClaimInline(admin.TabularInline):
    model = BillingClaim
    extra = 0
    ordering = ("seq",)
    fields = ("seq", "amount", "source", "triggered_by_unit", "state",
              "invoice_date", "invoice_no", "receive_date")
    readonly_fields = ("seq", "source", "triggered_by_unit")


@admin.register(BillingMilestone)
class BillingMilestoneAdmin(SimpleHistoryAdmin):
    list_display = (
        "project", "seq", "label", "percentage", "amount_display",
        "trigger_display", "progress_display", "state_display",
    )
    list_filter = ("state", "trigger_type", "project")
    search_fields = ("label", "project__name")
    ordering = ("project", "seq")
    autocomplete_fields = ("project", "phase", "target_location", "weight_basis_changed_by_co")
    inlines = [BillingClaimInline]
    readonly_fields = ("amount", "claimable_amount", "claimed_amount", "received_amount",
                       "state", "claimable_at", "weight_basis_locked_at")

    fieldsets = (
        (None, {
            "fields": ("project", "phase", "seq", "label", "trigger_desc", "percentage", "amount"),
            "description": "<b>金額由系統計算</b>＝有效合約額 × 比例，不可手改。"
                           "變更追加單核准時會自動重算",
        }),
        ("觸發設定", {
            "fields": ("trigger_type", "threshold_pct", "target_location"),
            "description": format_html(
                "<b>四種觸發方式（依合約逐筆設定）</b><br>"
                "<b>手動</b>：會計自行建立請款事件（如簽約訂金）<br>"
                "<b>該期全部簽收</b>：該期別最後一批簽收時，整筆轉可請款<br>"
                "<b>累計重量達門檻</b>：該期累計簽收噸數 ÷ 該期總噸數 ≥ 門檻時整筆轉可請款<br>"
                "<b>每批按量分批請</b>：每批簽收各產生一筆，"
                "金額＝里程碑金額 ×(該批噸數 ÷ 該期總噸數)<br><br>"
                "<b>指定交貨地點</b>：簽收地點不符時警告但不阻擋"
            ),
        }),
        ("分母鎖定", {
            "fields": ("weight_basis_kg", "weight_basis_locked_at", "weight_basis_changed_by_co"),
            "description": "⚠️ 首次觸發時系統會把該期總噸數固化成快照，"
                           "之後新增批次不影響已算過的比例。<b>要修改已鎖定的分母，"
                           "必須綁一張【已核准】的變更追加單</b>——"
                           "這把「要改就得重簽合約」變成技術上做不到的事",
        }),
        ("累計金額", {
            "fields": ("claimable_amount", "claimed_amount", "received_amount",
                       "state", "claimable_at"),
            "description": "由下方的請款事件推導，唯讀",
        }),
        ("其他", {"fields": ("note",), "classes": ("collapse",)}),
    )

    @admin.display(description="金額")
    def amount_display(self, obj):
        return f"{obj.amount:,.0f}"

    @admin.display(description="觸發方式")
    def trigger_display(self, obj):
        label = obj.get_trigger_type_display()
        if obj.trigger_type == TriggerType.WEIGHT_THRESHOLD and obj.threshold_pct:
            return f"{label}（{obj.threshold_pct:g}%）"
        return label

    @admin.display(description="請款進度")
    def progress_display(self, obj):
        if not obj.amount:
            return "—"
        parts = []
        for label, value, color in (
            ("可請", obj.claimable_amount, "#d97706"),
            ("已請", obj.claimed_amount, "#2a78d6"),
            ("已收", obj.received_amount, "#059669"),
        ):
            if value:
                parts.append(f'<span style="color:{color}">{label} {value:,.0f}</span>')
        return format_html("<br>".join(parts)) if parts else "—"

    @admin.display(description="狀態")
    def state_display(self, obj):
        return format_html(
            '<span style="color:{};font-weight:600">● {}</span>',
            STATE_COLORS.get(obj.state, "#64748b"), obj.get_state_display(),
        )

    def get_queryset(self, request):
        return super().get_queryset(request).select_related("project", "phase")


@admin.register(BillingClaim)
class BillingClaimAdmin(SimpleHistoryAdmin):
    list_display = ("milestone", "seq", "amount_display", "source",
                    "triggered_by_unit", "state", "invoice_date", "receive_date")
    list_filter = ("state", "source")
    search_fields = ("milestone__label", "invoice_no", "milestone__project__name")
    ordering = ("-claimable_at",)
    autocomplete_fields = ("milestone", "triggered_by_unit")
    readonly_fields = ("seq", "claimable_at", "source", "triggered_by_unit", "weight_kg_snapshot")

    @admin.display(description="金額")
    def amount_display(self, obj):
        return f"{obj.amount:,.0f}"

    def get_queryset(self, request):
        return super().get_queryset(request).select_related(
            "milestone", "milestone__project", "triggered_by_unit"
        )


@admin.register(BillingClaimLog)
class BillingClaimLogAdmin(admin.ModelAdmin):
    list_display = ("changed_at", "claim", "from_state", "to_state",
                    "is_auto", "amount_snapshot", "changed_by")
    list_filter = ("is_auto", "to_state")
    search_fields = ("claim__milestone__label", "reason")
    ordering = ("-changed_at",)
    readonly_fields = [f.name for f in BillingClaimLog._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
