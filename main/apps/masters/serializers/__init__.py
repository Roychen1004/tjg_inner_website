from rest_framework import serializers

from main.apps.masters.models import Customer, FlowItem, FlowStage, Stage, StageTemplate, Vendor


class FlowItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = FlowItem
        fields = [
            "id", "seq", "code", "name",
            "description", "deliverables", "done_criteria",
            "is_gate", "batch_stage_seq",
        ]


class FlowStageSerializer(serializers.ModelSerializer):
    """大階段＋底下的工作項。建案表單的勾選清單一次取完。"""

    items = serializers.SerializerMethodField()

    class Meta:
        model = FlowStage
        fields = ["id", "seq", "code", "name", "gate", "items"]

    def get_items(self, obj) -> list[dict]:
        items = sorted((i for i in obj.items.all() if i.is_active), key=lambda i: i.seq)
        return FlowItemSerializer(items, many=True).data


class StageSerializer(serializers.ModelSerializer):
    class Meta:
        model = Stage
        fields = ["id", "seq", "code", "name", "color", "stall_days"]


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
    """客戶。

    帳期兩欄一起帶：現金流的收入側全靠它推算「錢哪天會到」，
    少了它整個收款側就只能是一片空白。
    """

    payment_terms_display = serializers.SerializerMethodField()

    class Meta:
        model = Customer
        fields = [
            "id", "code", "name", "tax_id", "contact_name", "contact_phone",
            "payment_term_type", "payment_term_days", "payment_terms_display", "is_active",
        ]

    def get_payment_terms_display(self, obj) -> str:
        from main.apps.payables.services import terms_service

        return terms_service.describe(obj.payment_term_type, obj.payment_term_days)


class VendorSerializer(serializers.ModelSerializer):
    type_display = serializers.CharField(read_only=True)

    class Meta:
        model = Vendor
        fields = ["id", "code", "name", "type_display", "contact_name", "contact_phone", "is_active"]


