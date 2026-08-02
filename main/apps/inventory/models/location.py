from django.core.exceptions import ValidationError
from django.db import models

from main.utils.choices import LocationType


class LocationQuerySet(models.QuerySet):
    def active(self):
        return self.filter(is_active=True)

    def descendants_of(self, location):
        """含自身的所有下層位置（倉庫→區→排→層）"""
        ids, frontier = {location.pk}, [location.pk]
        while frontier:
            children = list(
                self.filter(parent_id__in=frontier).values_list("pk", flat=True)
            )
            children = [c for c in children if c not in ids]
            ids.update(children)
            frontier = children
        return self.filter(pk__in=ids)


class Location(models.Model):
    """物理位置（階層式）

    關鍵在於 site 與 vendor 兩種類型：送外包噴砂的料，在傳統倉儲系統裡
    「已出庫」等於消失。這裡它仍在帳上，只是位置變成「全興噴砂廠」——
    直接接上外包逾期追蹤（決策 D10）。
    """

    code = models.CharField("位置代號", max_length=30, unique=True, help_text="如 WH-A-3-2")
    name = models.CharField("位置名稱", max_length=80, help_text="如「A倉3排2層」")
    location_type = models.CharField("類型", max_length=20, choices=LocationType.choices)
    parent = models.ForeignKey(
        "self", verbose_name="上層位置", on_delete=models.SET_NULL,
        null=True, blank=True, related_name="children",
    )

    project = models.ForeignKey(
        "projects.Project", verbose_name="關聯專案",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="site_locations",
        help_text="類型為「工地」時必填，讓「料已進場」成為可查詢的事實",
    )
    vendor = models.ForeignKey(
        "masters.Vendor", verbose_name="關聯廠商",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="vendor_locations",
        help_text="類型為「外包廠」時必填，讓送外包的料仍在帳上",
    )

    capacity_note = models.CharField("容量備註", max_length=100, blank=True)
    is_active = models.BooleanField("啟用中", default=True)

    objects = LocationQuerySet.as_manager()

    class Meta:
        db_table = "inventory_location"
        verbose_name = verbose_name_plural = "位置"
        ordering = ["location_type", "code"]
        indexes = [models.Index(fields=["location_type"])]

    def __str__(self):
        return self.name

    @property
    def full_path(self):
        parts, node, guard = [], self, 0
        while node and guard < 10:
            parts.append(node.name)
            node, guard = node.parent, guard + 1
        return " / ".join(reversed(parts))

    def clean(self):
        if self.location_type == LocationType.SITE and not self.project_id:
            raise ValidationError({"project": "類型為「工地」時必須指定關聯專案"})
        if self.location_type == LocationType.VENDOR and not self.vendor_id:
            raise ValidationError({"vendor": "類型為「外包廠」時必須指定關聯廠商"})
