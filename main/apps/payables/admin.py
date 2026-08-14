from django.contrib import admin

from main.apps.payables.models import Payable, Subcontract


@admin.register(Subcontract)
class SubcontractAdmin(admin.ModelAdmin):
    list_display = ["code", "title", "project", "vendor", "contract_amount", "status"]
    list_filter = ["status", "category"]
    search_fields = ["code", "title", "vendor__name"]
    autocomplete_fields = ["project", "vendor"]


@admin.register(Payable)
class PayableAdmin(admin.ModelAdmin):
    list_display = ["title", "vendor", "project", "payable_amount", "state", "due_date"]
    list_filter = ["state", "category", "payment_method"]
    search_fields = ["title", "vendor__name", "invoice_no"]
    autocomplete_fields = ["project", "vendor", "subcontract"]
