from decimal import Decimal

from rest_framework import serializers

from main.apps.core.serializers import UserBriefSerializer
from main.apps.masters.serializers import CustomerSerializer, StageSerializer
from main.apps.projects.models import ChangeOrder, Project
from main.utils.choices import ChangeOrderStatus
from main.utils.permissions import has_permission
from main.utils.scoping import can_view_amount


class AmountScopedMixin:
    """金額欄位依角色過濾。

    ⚠️ 這不是前端隱藏——廠長／採購／品保／倉管拿到的 JSON 裡，
    金額欄位就是 null，值根本沒離開伺服器（決策 D09）。
    """

    def _user(self):
        request = self.context.get("request")
        return getattr(request, "user", None)

    def _visible(self, project=None):
        return can_view_amount(self._user(), project)

    def _money(self, value, project=None):
        if value is None or not self._visible(project):
            return None
        return str(value)


class ProjectListSerializer(AmountScopedMixin, serializers.ModelSerializer):
    """清單用。刻意不含分期／合約條款——列表不需要，省頻寬也省記憶體。"""

    customer_name = serializers.CharField(source="customer.name", read_only=True, default="")
    owner_name = serializers.CharField(source="owner.name", read_only=True, default="")
    project_type_label = serializers.CharField(source="get_project_type_display", read_only=True)

    main_stage_name = serializers.CharField(source="main_stage.name", read_only=True)
    main_stage_seq = serializers.IntegerField(source="main_stage.seq", read_only=True)
    # ⚠️ 必須是 SerializerMethodField。寫成 IntegerField(read_only=True) 時，
    # 模型上沒有這個屬性，DRF 會**靜靜地跳過**（read_only ⇒ required=False ⇒ SkipField），
    # 前端拿不到值卻也不會報錯——進度軌道就變成一片空白。
    main_stage_total = serializers.SerializerMethodField()

    unit_count = serializers.IntegerField(read_only=True)
    attention_count = serializers.IntegerField(read_only=True)
    is_overdue = serializers.BooleanField(read_only=True)
    days_left = serializers.SerializerMethodField()

    contract_amount = serializers.SerializerMethodField()
    effective_amount = serializers.SerializerMethodField()
    received_amount = serializers.SerializerMethodField()
    collection_rate = serializers.SerializerMethodField()

    class Meta:
        model = Project
        fields = [
            "id", "code", "name", "project_type", "project_type_label",
            "customer_name", "owner_name",
            "contract_amount", "effective_amount", "received_amount", "collection_rate",
            "start_date", "due_date", "actual_end_date", "is_overdue", "days_left",
            "main_stage_name", "main_stage_seq", "main_stage_total",
            "status", "is_closed", "unit_count", "attention_count",
        ]

    def get_main_stage_total(self, obj) -> int:
        # 靠 prefetch_related("main_template__stages") 在記憶體裡數，不是每列一次 COUNT
        return sum(1 for s in obj.main_template.stages.all() if s.is_active)

    def get_days_left(self, obj) -> int | None:
        from django.utils import timezone

        if not obj.due_date or obj.is_closed:
            return None
        return (obj.due_date - timezone.localdate()).days

    def get_contract_amount(self, obj) -> str | None:
        return self._money(obj.contract_amount, obj)

    def get_effective_amount(self, obj) -> str | None:
        return self._money(obj.effective_amount, obj)

    def get_received_amount(self, obj) -> str | None:
        return self._money(obj.received_amount, obj)

    def get_collection_rate(self, obj) -> float | None:
        return obj.collection_rate if self._visible(obj) else None


class ProjectDetailSerializer(ProjectListSerializer):
    """明細用。多帶主線階段全貌、應收款、合約條款與可執行的操作。"""

    customer = CustomerSerializer(read_only=True)
    owner = UserBriefSerializer(read_only=True)
    main_stage = StageSerializer(read_only=True)
    main_stages = serializers.SerializerMethodField()
    milestones = serializers.SerializerMethodField()
    approved_change_amount = serializers.SerializerMethodField()

    can_advance = serializers.SerializerMethodField()
    can_rollback = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()
    can_view_amounts = serializers.SerializerMethodField()

    class Meta(ProjectListSerializer.Meta):
        fields = ProjectListSerializer.Meta.fields + [
            "customer", "owner", "main_stage", "main_stages", "milestones",
            "approved_change_amount", "note", "contract_terms", "quote_info", "doc_links",
            "can_advance", "can_rollback", "can_edit", "can_view_amounts",
        ]

    def get_main_stages(self, obj) -> list[dict]:
        stages = obj.main_template.stages.filter(is_active=True).order_by("seq")
        return StageSerializer(stages, many=True).data

    def get_milestones(self, obj) -> list[dict]:
        """應收款直接掛在專案明細上——案子的錢跟案子一起看，不用切分頁。

        檢視角色拿到空陣列：應收款整列都是金額。
        """
        if not self._visible(obj):
            return []
        from main.apps.billing.serializers import BillingMilestoneSerializer

        rows = obj.milestones.all().order_by("seq")
        return BillingMilestoneSerializer(rows, many=True, context=self.context).data

    def get_approved_change_amount(self, obj) -> str | None:
        return self._money(obj.approved_change_amount, obj)

    def get_can_advance(self, obj) -> bool:
        if obj.is_closed or not has_permission(self._user(), "edit_project"):
            return False
        return not obj.main_stage.is_final

    def get_can_rollback(self, obj) -> bool:
        if obj.is_closed or not has_permission(self._user(), "edit_project"):
            return False
        return not obj.main_stage.is_first

    def get_can_edit(self, obj) -> bool:
        return not obj.is_closed and has_permission(self._user(), "edit_project")

    def get_can_view_amounts(self, obj) -> bool:
        return self._visible(obj)


class MilestoneRowSerializer(serializers.Serializer):
    """建案時一起填的請款分期，一列一期"""

    label = serializers.CharField(max_length=100)
    percentage = serializers.DecimalField(
        max_digits=5, decimal_places=2,
        min_value=Decimal("0"), max_value=Decimal("100"),
    )
    condition = serializers.CharField(required=False, allow_blank=True, max_length=200)
    expected_date = serializers.DateField(required=False, allow_null=True)


class ProjectWriteSerializer(serializers.ModelSerializer):
    """建立／修改。主線模板與起始階段由系統決定，不讓使用者選。

    合約的請款條件在建案時一起填（milestones）——合約簽下來的那一刻，
    付款分期就已經知道了，沒有理由讓使用者存檔後再去另一個分頁補。
    """

    milestones = MilestoneRowSerializer(many=True, required=False, write_only=True)

    class Meta:
        model = Project
        fields = [
            "name", "project_type", "customer", "contract_amount", "owner",
            "start_date", "due_date", "note", "status",
            "contract_terms", "quote_info", "doc_links", "milestones",
        ]

    def validate(self, attrs):
        start = attrs.get("start_date") or getattr(self.instance, "start_date", None)
        due = attrs.get("due_date") or getattr(self.instance, "due_date", None)
        if start and due and due < start:
            raise serializers.ValidationError({"due_date": "預計完工日不可早於開工日"})

        rows = attrs.get("milestones")
        if rows:
            total = sum(r["percentage"] for r in rows)
            if total > 100:
                raise serializers.ValidationError(
                    {"milestones": f"各期比例合計 {total}%，超過 100%"}
                )
        return attrs

    def create(self, validated_data):
        from main.apps.masters.models import StageTemplate
        from main.utils.choices import TemplateAppliesTo
        from main.utils.exceptions import BusinessRuleError

        rows = validated_data.pop("milestones", [])
        template = StageTemplate.default_for(TemplateAppliesTo.PROJECT_MAIN)
        if template is None:
            raise BusinessRuleError("尚未設定專案主線階段模板，請先執行 seed_masters")
        validated_data["main_template"] = template
        validated_data["main_stage"] = template.first_stage()
        request = self.context.get("request")
        if request:
            validated_data["created_by"] = request.user
        project = super().create(validated_data)

        from main.apps.billing.models import BillingMilestone

        for i, row in enumerate(rows, start=1):
            milestone = BillingMilestone.objects.create(
                project=project, seq=i, label=row["label"],
                percentage=row["percentage"], condition=row.get("condition", ""),
                expected_date=row.get("expected_date"),
            )
            milestone.recalc_amount()
        return project

    def update(self, instance, validated_data):
        # 分期列只在建立時整批帶入；之後逐列在專案明細裡改
        validated_data.pop("milestones", None)
        return super().update(instance, validated_data)


class ChangeOrderSerializer(AmountScopedMixin, serializers.ModelSerializer):
    approved_by_name = serializers.CharField(source="approved_by.name", read_only=True, default="")
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    is_approved = serializers.BooleanField(read_only=True)
    amount = serializers.SerializerMethodField()

    class Meta:
        model = ChangeOrder
        fields = [
            "id", "code", "project", "title", "amount", "reason",
            "status", "status_label", "is_approved", "approved_by_name", "approved_at", "created_at",
        ]

    def get_amount(self, obj) -> str | None:
        return self._money(obj.amount, obj.project)


class ChangeOrderWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = ChangeOrder
        fields = ["project", "title", "amount", "reason", "status"]

    def validate_status(self, value):
        # 核准只能透過 /approve 端點，不能直接 PATCH 過去——
        # 否則核准的稽核軌跡（誰、何時）會空掉
        if value == ChangeOrderStatus.APPROVED:
            raise serializers.ValidationError("核准請使用「核准」操作，不可直接修改狀態")
        return value

    def create(self, validated_data):
        request = self.context.get("request")
        if request:
            validated_data["created_by"] = request.user
        return super().create(validated_data)


class AdvanceStageSerializer(serializers.Serializer):
    """專案主線推進／回退"""

    direction = serializers.ChoiceField(choices=[("forward", "推進"), ("backward", "回退")])
    note = serializers.CharField(required=False, allow_blank=True, max_length=500)
