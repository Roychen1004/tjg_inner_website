from django.contrib.postgres.fields import ArrayField
from django.contrib.postgres.indexes import GinIndex
from django.db import models
from simple_history.models import HistoricalRecords

from main.apps.core.models import TimeStampedModel
from main.utils.choices import VendorType


class VendorQuerySet(models.QuerySet):
    def of_type(self, vendor_type):
        return self.filter(vendor_types__contains=[vendor_type], is_active=True)

    def suppliers(self):
        return self.of_type(VendorType.SUPPLIER)

    def subcontractors(self):
        return self.of_type(VendorType.SUBCONTRACTOR)

    def outsourcers(self):
        return self.of_type(VendorType.OUTSOURCE)

    def transporters(self):
        return self.of_type(VendorType.TRANSPORT)


class Vendor(TimeStampedModel):
    """廠商總表：供應商／分包商／外包加工／運輸行

    刻意用一張表加類型陣列，而不是四張表——現實中「全興噴砂廠」
    可能同時是外包加工廠與供應商。分開建會重複建檔、統編對不起來，
    而且日後要做供應商評分時同一家廠商會有兩份分數。
    """

    code = models.CharField("廠商代號", max_length=20, unique=True)
    name = models.CharField("廠商名稱", max_length=100)
    tax_id = models.CharField("統一編號", max_length=8, blank=True)

    vendor_types = ArrayField(
        models.CharField(max_length=20, choices=VendorType.choices),
        verbose_name="廠商類型", default=list,
        help_text="可多選。同一家廠商可同時是供應商與外包加工廠",
    )

    contact_name = models.CharField("聯絡人", max_length=50, blank=True)
    contact_phone = models.CharField("聯絡電話", max_length=30, blank=True)
    address = models.CharField("地址", max_length=200, blank=True)
    payment_terms = models.CharField("付款條件", max_length=100, blank=True)
    note = models.TextField("備註", blank=True)
    is_active = models.BooleanField("啟用中", default=True)

    history = HistoricalRecords(table_name="masters_vendor_history")
    objects = VendorQuerySet.as_manager()

    class Meta:
        db_table = "masters_vendor"
        verbose_name = verbose_name_plural = "廠商"
        ordering = ["code"]
        indexes = [GinIndex(fields=["vendor_types"], name="idx_vendor_types_gin")]

    def __str__(self):
        return self.name

    @property
    def type_display(self):
        labels = dict(VendorType.choices)
        return "、".join(labels.get(t, t) for t in self.vendor_types)
