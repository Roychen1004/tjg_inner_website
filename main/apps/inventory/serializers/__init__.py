from rest_framework import serializers

from main.apps.inventory.models import Location, Lot, StockTransaction


class LocationSerializer(serializers.ModelSerializer):
    type_label = serializers.CharField(source="get_location_type_display", read_only=True)
    full_path = serializers.CharField(read_only=True)
    project_name = serializers.CharField(source="project.name", read_only=True, default="")
    vendor_name = serializers.CharField(source="vendor.name", read_only=True, default="")

    class Meta:
        model = Location
        fields = [
            "id", "code", "name", "full_path", "location_type", "type_label",
            "parent", "project", "project_name", "vendor", "vendor_name",
            "capacity_note", "is_active",
        ]


class LotSerializer(serializers.ModelSerializer):
    """數量型物品的庫存批 —— 建材與零件耗材。

    回答的是「還剩多少、在哪、能不能用、放多久了」。
    尺寸與材質從 Item 帶出來，因為「找一支 6M 的 H300」是實際會發生的查詢。
    """

    item_code = serializers.CharField(source="item.code", read_only=True)
    item_name = serializers.CharField(source="item.name", read_only=True)
    item_kind = serializers.CharField(source="item.item_kind", read_only=True)
    spec_label = serializers.CharField(source="item.spec_label", read_only=True, default="")
    material_grade = serializers.CharField(source="item.material_grade", read_only=True, default="")
    unit_of_measure = serializers.CharField(source="item.unit_of_measure", read_only=True)
    surface_treatment = serializers.CharField(
        source="item.get_surface_treatment_display", read_only=True, default="",
    )
    dimensions = serializers.SerializerMethodField()

    location_name = serializers.CharField(source="location.name", read_only=True)
    location_path = serializers.CharField(source="location.full_path", read_only=True)
    location_type = serializers.CharField(source="location.location_type", read_only=True)

    status_label = serializers.CharField(source="get_status_display", read_only=True)
    aging_label = serializers.CharField(source="get_aging_status_display", read_only=True)
    aging_days = serializers.IntegerField(read_only=True)
    qty_available = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    total_weight_kg = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)

    reserved_for_project_name = serializers.CharField(
        source="reserved_for_project.name", read_only=True, default="",
    )
    parent_lot_no = serializers.CharField(source="parent_lot.lot_no", read_only=True, default="")

    class Meta:
        model = Lot
        fields = [
            "id", "lot_no", "item", "item_code", "item_name", "item_kind",
            "spec_label", "material_grade", "surface_treatment", "dimensions", "unit_of_measure",
            "location", "location_name", "location_path", "location_type",
            "qty_on_hand", "qty_reserved", "qty_available", "total_weight_kg",
            "status", "status_label", "aging_status", "aging_label", "aging_days",
            "reserved_for_project", "reserved_for_project_name",
            "received_date", "last_move_date",
            "mill_cert_no", "heat_no", "source_po_no",
            "is_remnant", "parent_lot", "parent_lot_no",
            "actual_length_mm", "actual_width_mm", "note",
        ]

    def get_dimensions(self, obj) -> dict[str, str]:
        dims = {k: str(v) for k, v in obj.item.dimensions.items()}
        # 餘料的實際尺寸會與母材不同，覆蓋掉才不會誤導找料的人
        if obj.is_remnant:
            if obj.actual_length_mm:
                dims["length_mm"] = str(obj.actual_length_mm)
            if obj.actual_width_mm:
                dims["width_mm"] = str(obj.actual_width_mm)
        return dims


class LotReceiveSerializer(serializers.Serializer):
    """入庫建檔。

    P1 主要用途是**期初盤點**——把倉庫現有的料一次建進系統。
    P2 導入採購後，收料會由採購單帶出來。
    """

    item = serializers.IntegerField(label="物品")
    location = serializers.IntegerField(label="存放位置")
    qty = serializers.DecimalField(max_digits=12, decimal_places=2, label="數量")
    lot_no = serializers.CharField(required=False, allow_blank=True, max_length=40)
    unit_cost = serializers.DecimalField(
        max_digits=12, decimal_places=2, required=False, allow_null=True,
    )
    mill_cert_no = serializers.CharField(required=False, allow_blank=True, max_length=50)
    heat_no = serializers.CharField(required=False, allow_blank=True, max_length=30)
    source_po_no = serializers.CharField(required=False, allow_blank=True, max_length=30)
    reserved_for_project = serializers.IntegerField(required=False, allow_null=True)
    received_date = serializers.DateField(required=False, allow_null=True)
    note = serializers.CharField(required=False, allow_blank=True, max_length=300)


class LotAdjustSerializer(serializers.Serializer):
    """盤點調整。原因必填——帳實不符是管理問題，要有人交代。"""

    new_qty = serializers.DecimalField(max_digits=12, decimal_places=2, label="實際數量")
    note = serializers.CharField(max_length=300, label="原因")


class LotIssueSerializer(serializers.Serializer):
    qty = serializers.DecimalField(max_digits=12, decimal_places=2, label="領用數量")
    project = serializers.IntegerField(required=False, allow_null=True)
    tracking_unit = serializers.IntegerField(
        required=False, allow_null=True,
        help_text="指定批次時，材料成本會自動歸集到那一批",
    )
    note = serializers.CharField(required=False, allow_blank=True, max_length=300)


class StockTransactionSerializer(serializers.ModelSerializer):
    """出入庫歷程"""

    lot_no = serializers.CharField(source="lot.lot_no", read_only=True)
    item_name = serializers.CharField(source="lot.item.name", read_only=True)
    type_label = serializers.CharField(source="get_txn_type_display", read_only=True)
    from_location_name = serializers.CharField(source="from_location.name", read_only=True, default="")
    to_location_name = serializers.CharField(source="to_location.name", read_only=True, default="")
    project_name = serializers.CharField(source="project.name", read_only=True, default="")
    operator_name = serializers.CharField(source="operator.name", read_only=True, default="系統")

    class Meta:
        model = StockTransaction
        fields = [
            "id", "lot", "lot_no", "item_name", "txn_type", "type_label",
            "qty", "qty_before", "qty_after",
            "from_location_name", "to_location_name",
            "project", "project_name", "tracking_unit",
            "ref_doc_type", "ref_doc_no", "operator_name", "occurred_at", "note",
        ]
