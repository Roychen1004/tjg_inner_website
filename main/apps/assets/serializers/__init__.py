from rest_framework import serializers

from main.apps.assets.models import AssetMovement, AssetUnit


class AssetUnitSerializer(serializers.ModelSerializer):
    """個體型資產 —— 工具與設備。

    回答的是「在誰手上、用在哪個案子、放在哪、該校驗了沒」。
    與數量型的建材（Lot）分開，因為問的問題根本不同：
    建材問「還剩多少」，工具問「在誰手上」。
    """

    item_name = serializers.CharField(source="item.name", read_only=True)
    item_code = serializers.CharField(source="item.code", read_only=True)
    item_kind = serializers.CharField(source="item.item_kind", read_only=True)

    location_name = serializers.CharField(source="location.name", read_only=True)
    location_path = serializers.CharField(source="location.full_path", read_only=True)
    holder_name = serializers.CharField(source="holder.name", read_only=True, default="")
    current_project_name = serializers.CharField(
        source="current_project.name", read_only=True, default="",
    )
    current_project_code = serializers.CharField(
        source="current_project.code", read_only=True, default="",
    )

    status_label = serializers.CharField(source="get_asset_status_display", read_only=True)
    is_calibration_overdue = serializers.BooleanField(read_only=True)
    is_maintenance_overdue = serializers.BooleanField(read_only=True)

    class Meta:
        model = AssetUnit
        fields = [
            "id", "asset_no", "item", "item_code", "item_name", "item_kind",
            "serial_no", "brand", "model",
            "location", "location_name", "location_path",
            "holder", "holder_name",
            "current_project", "current_project_name", "current_project_code",
            "asset_status", "status_label",
            "purchase_date", "purchase_cost", "book_value",
            "last_maintenance_date", "next_maintenance_date", "calibration_due_date",
            "is_calibration_overdue", "is_maintenance_overdue",
            "photo", "note", "is_active",
        ]


class AssetUnitWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = AssetUnit
        fields = [
            "asset_no", "item", "serial_no", "brand", "model",
            "location", "holder", "current_project", "asset_status",
            "purchase_date", "purchase_cost", "depreciation_years",
            "last_maintenance_date", "next_maintenance_date", "calibration_due_date",
            "photo", "note", "is_active",
        ]


class AssetMovementSerializer(serializers.ModelSerializer):
    asset_no = serializers.CharField(source="asset.asset_no", read_only=True)
    type_label = serializers.CharField(source="get_movement_type_display", read_only=True)
    from_location_name = serializers.CharField(source="from_location.name", read_only=True, default="")
    to_location_name = serializers.CharField(source="to_location.name", read_only=True, default="")
    from_holder_name = serializers.CharField(source="from_holder.name", read_only=True, default="")
    to_holder_name = serializers.CharField(source="to_holder.name", read_only=True, default="")
    to_project_name = serializers.CharField(source="to_project.name", read_only=True, default="")
    operator_name = serializers.CharField(source="operator.name", read_only=True, default="系統")

    class Meta:
        model = AssetMovement
        fields = [
            "id", "asset", "asset_no", "movement_type", "type_label",
            "from_location_name", "to_location_name",
            "from_holder_name", "to_holder_name", "to_project_name",
            "operator_name", "occurred_at", "note",
        ]


class AssetMoveSerializer(serializers.Serializer):
    """派用／歸還／移轉。一個動作同時改位置、持有人、專案三者，
    並留下不可竄改的異動紀錄。"""

    movement_type = serializers.CharField(max_length=20)
    to_location = serializers.IntegerField(required=False, allow_null=True)
    to_holder = serializers.IntegerField(required=False, allow_null=True)
    to_project = serializers.IntegerField(required=False, allow_null=True)
    note = serializers.CharField(required=False, allow_blank=True, max_length=300)
