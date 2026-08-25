from decimal import Decimal

from rest_framework import serializers

from main.apps.core.serializers import UserBriefSerializer
from main.apps.masters.models import FlowItem
from main.apps.masters.serializers import CustomerSerializer
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
    lifecycle_label = serializers.CharField(source="get_lifecycle_display", read_only=True)

    unit_count = serializers.IntegerField(read_only=True)
    attention_count = serializers.IntegerField(read_only=True)
    is_overdue = serializers.BooleanField(read_only=True)
    days_left = serializers.SerializerMethodField()
    flow_gantt = serializers.SerializerMethodField()

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
            "status", "lifecycle", "lifecycle_label", "is_closed",
            "unit_count", "attention_count", "flow_gantt",
        ]

    def get_days_left(self, obj) -> int | None:
        from django.utils import timezone

        if not obj.due_date or obj.is_closed:
            return None
        return (obj.due_date - timezone.localdate()).days

    def get_flow_gantt(self, obj) -> list[dict]:
        """卡片迷你甘特：五大階段各一條 bar（起訖日、完成數、有沒有逾期）。"""
        from main.apps.tracking.services.flow_service import gantt_rows

        return gantt_rows(obj)

    def get_contract_amount(self, obj) -> str | None:
        return self._money(obj.contract_amount, obj)

    def get_effective_amount(self, obj) -> str | None:
        return self._money(obj.effective_amount, obj)

    def get_received_amount(self, obj) -> str | None:
        return self._money(obj.received_amount, obj)

    def get_collection_rate(self, obj) -> float | None:
        return obj.collection_rate if self._visible(obj) else None


class ProjectDetailSerializer(ProjectListSerializer):
    """明細用。多帶流程單元、應收款、合約條款與可執行的操作。"""

    customer = CustomerSerializer(read_only=True)
    owner = UserBriefSerializer(read_only=True)
    milestones = serializers.SerializerMethodField()
    flow_units = serializers.SerializerMethodField()
    approved_change_amount = serializers.SerializerMethodField()
    estimate_amount = serializers.SerializerMethodField()

    can_edit = serializers.SerializerMethodField()
    can_view_amounts = serializers.SerializerMethodField()

    class Meta(ProjectListSerializer.Meta):
        fields = ProjectListSerializer.Meta.fields + [
            "customer", "owner", "milestones", "flow_units",
            "approved_change_amount", "estimate_amount",
            "note", "contract_terms", "quote_info", "doc_links",
            "can_edit", "can_view_amounts",
        ]

    def get_flow_units(self, obj) -> list[dict]:
        """整個案子的流程清單，依目錄順序。前端按 stage_seq 分五段畫排程表。"""
        from main.apps.tracking.serializers import FlowUnitSerializer

        units = obj.flow_units.select_related(
            "flow_item__stage", "assignee", "subcontractor", "project"
        ).prefetch_related("tasks__assignments__assignee").order_by("flow_item__seq")
        return FlowUnitSerializer(units, many=True, context=self.context).data

    def get_estimate_amount(self, obj) -> str | None:
        return self._money(obj.estimate_amount, obj)

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
    trigger_flow_item = serializers.IntegerField(
        required=False, allow_null=True,
        help_text="觸發流程的目錄 id（要在 flow_items 勾選清單裡）。該流程完成→本期自動可請款",
    )


class ProjectWriteSerializer(serializers.ModelSerializer):
    """建立／修改。

    建案一頁完成（2026-08-14 流程制改版）：
      · flow_items —— 勾選這個案子有哪些流程，每勾一項生成一張流程單元。
        順序由目錄的 seq 決定，這裡收到什麼順序都一樣。
      · milestones —— 簽約後把合約的付款分期一起填；估價中可以先不填。
    """

    milestones = MilestoneRowSerializer(many=True, required=False, write_only=True)
    # QuerySet 是惰性的，在此宣告不會在載入時查 DB
    flow_items = serializers.PrimaryKeyRelatedField(
        many=True, required=False, write_only=True,
        queryset=FlowItem.objects.filter(is_active=True),
        help_text="勾選的流程工作項 id 清單。只在建立時整批帶入，之後用 set-flows 調整",
    )

    class Meta:
        model = Project
        fields = [
            "name", "project_type", "customer", "contract_amount", "estimate_amount",
            "owner", "start_date", "due_date", "note", "status", "lifecycle",
            "contract_terms", "quote_info", "doc_links", "milestones", "flow_items",
        ]
        extra_kwargs = {"project_type": {"required": False}}

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
        from main.apps.tracking.models import FlowUnit
        from main.utils.choices import ProjectType, TemplateAppliesTo
        from main.utils.exceptions import BusinessRuleError

        rows = validated_data.pop("milestones", [])
        flow_items = validated_data.pop("flow_items", [])
        validated_data.setdefault("project_type", ProjectType.STEEL)
        # main_template/main_stage 是遺留欄位（D38 起主線由流程進度自動判定，
        # API 不再輸出）。DB 欄位 NOT NULL 且 migrations 只加不改，建立時仍要填
        template = StageTemplate.default_for(TemplateAppliesTo.PROJECT_MAIN)
        if template is None:
            raise BusinessRuleError("尚未設定專案主線階段模板，請先執行 seed_masters")
        validated_data["main_template"] = template
        validated_data["main_stage"] = template.first_stage()
        request = self.context.get("request")
        if request:
            validated_data["created_by"] = request.user
        project = super().create(validated_data)

        # 勾了哪些流程就生哪些單元。存的順序無所謂——讀取永遠照目錄 seq 排
        unit_by_item = {}
        for item in sorted(flow_items, key=lambda i: i.seq):
            unit_by_item[item.pk] = FlowUnit.create_for(project, item)

        from main.apps.billing.models import BillingMilestone

        for i, row in enumerate(rows, start=1):
            milestone = BillingMilestone.objects.create(
                project=project, seq=i, label=row["label"],
                percentage=row["percentage"], condition=row.get("condition", ""),
                expected_date=row.get("expected_date"),
                # 期別掛觸發流程（金流軌）：填的是目錄 id，這裡換成剛生成的單元
                trigger_unit=unit_by_item.get(row.get("trigger_flow_item")),
            )
            milestone.recalc_amount()
        return project

    def update(self, instance, validated_data):
        # 分期與流程勾選只在建立時整批帶入；之後分期逐列改、流程用 set-flows
        validated_data.pop("milestones", None)
        validated_data.pop("flow_items", None)
        project = super().update(instance, validated_data)
        # 合約額或估價金額改了，未請款的期別金額跟著動
        if {"contract_amount", "estimate_amount"} & set(validated_data):
            for milestone in project.milestones.all():
                milestone.recalc_amount()
        return project


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


