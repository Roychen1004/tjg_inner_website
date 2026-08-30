from rest_framework import serializers

from main.apps.masters.models import (
    Customer,
    FlowItem,
    FlowStage,
    FlowTemplate,
    MaterialItem,
    Stage,
    StageTemplate,
    Vendor,
    WorkType,
)


class FlowItemSerializer(serializers.ModelSerializer):
    in_use = serializers.SerializerMethodField()

    class Meta:
        model = FlowItem
        fields = [
            "id", "template", "stage", "seq", "code", "name",
            "description", "deliverables", "done_criteria",
            "is_gate", "batch_stage_seq", "in_use",
        ]

    def get_in_use(self, obj) -> bool:
        """有沒有案子用過這一項——用過的不能刪，只能停用。"""
        count = getattr(obj, "unit_count", None)
        if count is not None:
            return count > 0
        return obj.units.exists()


class FlowTemplateSerializer(serializers.ModelSerializer):
    """流程模板（D49）。item_count 給列表顯示；內容用 flow-catalog?template= 取。"""

    item_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = FlowTemplate
        fields = ["id", "name", "is_default", "is_active", "item_count"]

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("請填寫模板名稱")
        clash = FlowTemplate.objects.filter(name=value)
        if self.instance:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError(f"「{value}」已存在")
        return value


class FlowItemWriteSerializer(serializers.ModelSerializer):
    """新增／修改模板裡的工作項（D49，經理與系統管理員）。

    seq 與 code 不開放直接填——由後端依「該階段的最後」自動編；
    順序之後用模板的 reorder 動作調。
    """

    class Meta:
        model = FlowItem
        fields = [
            "template", "stage", "name",
            "description", "deliverables", "done_criteria",
        ]
        extra_kwargs = {
            "template": {"required": True, "allow_null": False},
            "stage": {"required": True, "allow_null": False},
        }

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("請填寫工作項名稱")
        return value

    def create(self, validated_data):
        template = validated_data["template"]
        stage = validated_data["stage"]
        # 模板內排序：接在該階段現有項目的後面、下一階段之前
        stage_items = list(
            FlowItem.objects.filter(template=template, stage=stage).order_by("seq")
        )
        used_seqs = set(
            FlowItem.objects.filter(template=template).values_list("seq", flat=True)
        )
        seq = (stage_items[-1].seq + 1) if stage_items else stage.seq * 10 + 1
        while seq in used_seqs:
            seq += 1
        # 代號：該階段下一個沒用過的號碼（如 3.5）
        used_codes = set(
            FlowItem.objects.filter(template=template).values_list("code", flat=True)
        )
        n = len(stage_items) + 1
        while f"{stage.seq}.{n}" in used_codes:
            n += 1
        validated_data["seq"] = seq
        validated_data["code"] = f"{stage.seq}.{n}"
        return super().create(validated_data)

    def update(self, instance, validated_data):
        # 建好之後不能搬家——換模板／換階段會讓已建案子的參照講不清楚
        validated_data.pop("template", None)
        validated_data.pop("stage", None)
        return super().update(instance, validated_data)


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




# ── 產能與成本的主檔（D52）────────────────────────────────────────
class WorkTypeSerializer(serializers.ModelSerializer):
    """工作類型標籤——分配工作時必選，產能統計的分類基準。"""

    class Meta:
        model = WorkType
        fields = ["id", "name", "is_active"]

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("請填寫類型名稱，如「焊接」")
        return value


class MaterialItemSerializer(serializers.ModelSerializer):
    """品項——應付明細指到這裡，單價走勢按品項累積。"""

    class Meta:
        model = MaterialItem
        fields = ["id", "name", "unit_of_measure", "is_active"]

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("請填寫品項名稱，如「鋼材」")
        return value
