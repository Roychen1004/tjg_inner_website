from rest_framework import serializers

from main.apps.masters.models import Customer, Item, ItemCategory, Stage, StageTemplate, Vendor


class StageSerializer(serializers.ModelSerializer):
    """階段。五個旗標一起送，前端據此決定顯示什麼圖示與哪些欄位。"""

    class Meta:
        model = Stage
        fields = [
            "id", "seq", "code", "name", "color",
            "is_billing_trigger", "requires_signoff", "is_outsource", "is_hold", "is_core",
            "stall_days",
        ]


class StageTemplateSerializer(serializers.ModelSerializer):
    stages = serializers.SerializerMethodField()

    class Meta:
        model = StageTemplate
        fields = ["id", "code", "name", "applies_to", "is_default", "stages"]

    def get_stages(self, obj) -> list[dict]:
        stages = sorted(
            (s for s in obj.stages.all() if s.is_active), key=lambda s: s.seq
        )
        return StageSerializer(stages, many=True).data


class CustomerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Customer
        fields = ["id", "code", "name", "tax_id", "contact_name", "contact_phone", "is_active"]


class VendorSerializer(serializers.ModelSerializer):
    type_display = serializers.CharField(read_only=True)

    class Meta:
        model = Vendor
        fields = ["id", "code", "name", "type_display", "contact_name", "contact_phone", "is_active"]


class ItemCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = ItemCategory
        fields = ["id", "code", "name", "item_kind", "parent"]


class ItemSerializer(serializers.ModelSerializer):
    """物品主檔。

    `dimensions` 只回傳該料型用得到、且有填的尺寸——
    鋼板不會出現「腹板厚」，H型鋼不會出現「外徑」。
    """

    category_name = serializers.CharField(source="category.name", read_only=True, default="")
    dimensions = serializers.SerializerMethodField()
    profile_type_label = serializers.CharField(source="get_profile_type_display", read_only=True)
    surface_label = serializers.CharField(source="get_surface_treatment_display", read_only=True)

    class Meta:
        model = Item
        fields = [
            "id", "code", "name", "item_kind", "tracking_mode", "unit_of_measure",
            "category", "category_name",
            "profile_type", "profile_type_label", "spec_label", "material_grade", "standard",
            "dimensions", "unit_weight_kg", "surface_treatment", "surface_label",
            "requires_mill_cert", "safety_stock", "standard_cost", "photo", "note", "is_active",
        ]

    def get_dimensions(self, obj) -> dict[str, str]:
        return {k: str(v) for k, v in obj.dimensions.items()}
