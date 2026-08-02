from rest_framework import serializers

from main.apps.production.models import ProductionLine


class ProductionLineSerializer(serializers.ModelSerializer):
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    updated_by_name = serializers.CharField(source="updated_by.name", read_only=True, default="")

    class Meta:
        model = ProductionLine
        fields = [
            "id", "code", "name", "status", "status_label",
            "current_work", "utilization", "today_output",
            "sort_order", "updated_by_name", "updated_at",
        ]


class ProductionLineWriteSerializer(serializers.ModelSerializer):
    """P1 由廠長人工更新。P3 導入報工後改為自動計算，這個端點就會退場。"""

    class Meta:
        model = ProductionLine
        fields = ["status", "current_work", "utilization", "today_output"]

    def validate_utilization(self, value):
        if value is not None and not 0 <= value <= 100:
            raise serializers.ValidationError("稼動率必須介於 0 與 100 之間")
        return value

    def update(self, instance, validated_data):
        request = self.context.get("request")
        if request:
            validated_data["updated_by"] = request.user
        return super().update(instance, validated_data)
