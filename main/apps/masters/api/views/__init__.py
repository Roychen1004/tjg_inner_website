"""
主檔 API

**一張表一個端點。** 客戶與廠商原本各有兩套 ViewSet——
一套唯讀給下拉選單、一套 CRUD 給維護頁——是不必要的分裂：
同一份資料兩個網址、兩個序列化器、兩處篩選邏輯要同步。

改成一個端點，讀寫用不同權限：
    read_permission  = None（登入即可）  全體員工都要用下拉
    write_permission = manage_masters   只有經理與系統管理員能改

哪些主檔在這裡維護、哪些留在 Django Admin（決策 D26）：
    客戶、廠商、員工 —— 每週都會動，欄位少 → 前端
    物品、位置、階段模板 —— 動得少，欄位多（物品依料型有不同尺寸欄位）→ Admin
"""
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Count, Q
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from main.apps.core.models import Department, Role, User
from main.apps.masters.models import (
    Customer, FlowItem, FlowStage, FlowTemplate, MaterialItem, Vendor, WorkType,
)
from main.apps.masters.serializers import (
    CustomerSerializer,
    FlowItemWriteSerializer,
    FlowStageSerializer,
    FlowTemplateSerializer,
    MaterialItemSerializer,
    VendorSerializer,
    WorkTypeSerializer,
)
from main.utils.choices import VendorType
from main.utils.exceptions import BusinessRuleError
from main.utils.viewsets import BaseModelViewSet

DEFAULT_PASSWORD = "28494320"


# ── 流程目錄 ───────────────────────────────────────────────────────
class FlowCatalogView(APIView):
    """GET /flow-catalog?template=<id> —— 五大階段＋該模板的工作項。

    不帶 template 就用預設模板（跟建案表單預選的一致）。
    D49 起模板內容由經理／系統管理員在「設定 → 流程模板」維護，
    不再需要進 Django Admin。
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(responses=FlowStageSerializer(many=True))
    def get(self, request):
        from django.db.models import Count, Prefetch

        template = None
        if tid := request.query_params.get("template"):
            template = FlowTemplate.objects.filter(pk=tid).first()
        if template is None:
            template = FlowTemplate.default()

        items = FlowItem.objects.filter(is_active=True).annotate(unit_count=Count("units"))
        # 資料遷移前的舊列 template 為空——一律視為預設模板的內容
        if template is not None:
            cond = Q(template=template)
            if template.is_default:
                cond |= Q(template__isnull=True)
            items = items.filter(cond)
        stages = (
            FlowStage.objects.filter(is_active=True)
            .prefetch_related(Prefetch("items", queryset=items))
            .order_by("seq")
        )
        return Response(FlowStageSerializer(stages, many=True).data)


def _renumber_template_codes(template):
    """模板工作項的代號依位置重編（D51）——跟專案內的顯示編號同一套邏輯。

    只編啟用中的；停用的保留原代號（反正不顯示）。
    兩段式改代號，避開 (template, code) 唯一約束在中途撞號。
    """
    if template is None:
        return
    cond = Q(template=template)
    if template.is_default:
        cond |= Q(template__isnull=True)
    items = list(
        FlowItem.objects.filter(cond, is_active=True)
        .select_related("stage").order_by("seq")
    )
    counters = {}
    targets = []
    for item in items:
        s = item.stage.seq
        counters[s] = counters.get(s, 0) + 1
        targets.append((item, f"{s}.{counters[s]}"))
    changed = [(i, c) for i, c in targets if i.code != c]
    if not changed:
        return
    with transaction.atomic():
        # 停用的項目讓出代號（改成 ~pk）——不然遞補會撞 (template, code) 唯一約束
        for stale in FlowItem.objects.filter(cond, is_active=False).exclude(
            code__startswith="~"
        ):
            FlowItem.objects.filter(pk=stale.pk).update(code=f"~{stale.pk}")
        for item, _code in changed:
            FlowItem.objects.filter(pk=item.pk).update(code=f"~{item.pk}")
        for item, code in changed:
            FlowItem.objects.filter(pk=item.pk).update(code=code)


class FlowTemplateViewSet(BaseModelViewSet):
    """流程模板（D49）。讀給全體（建案下拉），寫給經理與系統管理員。"""

    queryset = FlowTemplate.objects.all()
    serializer_class = FlowTemplateSerializer
    read_permission = None
    write_permission = "manage_masters"
    pagination_class = None

    def get_queryset(self):
        qs = super().get_queryset().annotate(item_count=Count("items", filter=Q(items__is_active=True)))
        if self.request.query_params.get("active") != "false":
            qs = qs.filter(is_active=True)
        return qs.order_by("-is_default", "id")

    def perform_destroy(self, instance):
        if instance.is_default:
            raise BusinessRuleError("預設模板不能刪除。要換預設，先把別套設為預設")
        # 有案子用過任何一項的模板不能刪（FlowUnit PROTECT），給人話
        from main.apps.tracking.models import FlowUnit

        if FlowUnit.objects.filter(flow_item__template=instance).exists():
            raise BusinessRuleError(
                f"「{instance.name}」已有案子使用，不可刪除。不再用的話請改為「停用」"
            )
        instance.delete()

    @action(detail=True, methods=["post"])
    def duplicate(self, request, pk=None):
        """複製一套模板（含全部工作項）——新模板通常從既有的改起。"""
        from main.utils.permissions import has_permission

        if not has_permission(request.user, "manage_masters"):
            return Response(
                {"type": "permission_denied", "detail": "你沒有維護流程模板的權限"},
                status=status.HTTP_403_FORBIDDEN,
            )
        source = self.get_object()
        name = str(request.data.get("name", "")).strip() or f"{source.name}（複製）"
        if FlowTemplate.objects.filter(name=name).exists():
            raise BusinessRuleError(f"「{name}」已存在，換個名字")
        with transaction.atomic():
            clone = FlowTemplate.objects.create(name=name, is_default=False, is_active=True)
            cond = Q(template=source)
            if source.is_default:
                cond |= Q(template__isnull=True)
            for item in FlowItem.objects.filter(cond, is_active=True).select_related("stage").order_by("seq"):
                FlowItem.objects.create(
                    template=clone, stage=item.stage, seq=item.seq, code=item.code,
                    name=item.name, description=item.description,
                    deliverables=item.deliverables, done_criteria=item.done_criteria,
                    is_gate=item.is_gate, batch_stage_seq=item.batch_stage_seq,
                )
        return Response(FlowTemplateSerializer(clone).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def reorder(self, request, pk=None):
        """重排模板內工作項的預設順序。body：{"item_ids": [依新順序]}"""
        from main.utils.permissions import has_permission

        if not has_permission(request.user, "manage_masters"):
            return Response(
                {"type": "permission_denied", "detail": "你沒有維護流程模板的權限"},
                status=status.HTTP_403_FORBIDDEN,
            )
        template = self.get_object()
        ids = request.data.get("item_ids", [])
        cond = Q(template=template)
        if template.is_default:
            cond |= Q(template__isnull=True)
        active = {i.pk for i in FlowItem.objects.filter(cond, is_active=True)}
        inactive = [i.pk for i in FlowItem.objects.filter(cond, is_active=False).order_by("seq")]
        if not isinstance(ids, list) or set(ids) != active:
            return Response(
                {"type": "validation_error",
                 "detail": "item_ids 必須是這套模板**全部啟用中**工作項的 id、依新順序排列"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        ordered = list(ids) + inactive  # 停用的排最後，不佔前面的號
        with transaction.atomic():
            # 兩段式重編，避開 (template, seq) 唯一約束在中途撞號
            # （seq 是 SmallInteger，暫存區間取 30000 起，別超過 32767）
            for offset, item_id in enumerate(ordered):
                FlowItem.objects.filter(pk=item_id).update(seq=30000 + offset)
            for pos, item_id in enumerate(ordered, start=1):
                FlowItem.objects.filter(pk=item_id).update(seq=pos)
        # 代號跟著新位置重編（D51）：3.4 移到前面就變 3.3
        _renumber_template_codes(template)
        return Response({"message": "順序已更新（只影響之後新建的案子）"})


class FlowItemViewSet(BaseModelViewSet):
    """模板裡的工作項（D49）。維護走這裡；清單看 flow-catalog。"""

    queryset = FlowItem.objects.all()
    serializer_class = FlowItemWriteSerializer
    write_serializer_class = FlowItemWriteSerializer
    read_permission = None
    write_permission = "manage_masters"
    http_method_names = ["post", "patch", "delete", "head", "options"]

    def perform_create(self, serializer):
        item = serializer.save()
        _renumber_template_codes(item.template)

    def perform_destroy(self, instance):
        if instance.units.exists():
            raise BusinessRuleError(
                f"「{instance.name}」已有 {instance.units.count()} 個案子用過，不可刪除。"
                "改為「停用」的話，之後的新案不會再出現這一項，舊案不受影響"
            )
        template = instance.template
        instance.delete()
        # 少一項，後面的代號往前遞補（D51）
        _renumber_template_codes(template)

    @action(detail=True, methods=["post"])
    def deactivate(self, request, pk=None):
        """停用（用過的項目刪不掉，走這裡）。"""
        from main.utils.permissions import has_permission

        if not has_permission(request.user, "manage_masters"):
            return Response(
                {"type": "permission_denied", "detail": "你沒有維護流程模板的權限"},
                status=status.HTTP_403_FORBIDDEN,
            )
        item = self.get_object()
        item.is_active = False
        item.save(update_fields=["is_active"])
        _renumber_template_codes(item.template)
        return Response({"message": f"「{item.name}」已停用，之後的新案不會再出現這一項"})


# ── 客戶 ───────────────────────────────────────────────────────────
class CustomerDetailSerializer(CustomerSerializer):
    project_count = serializers.IntegerField(read_only=True)

    class Meta(CustomerSerializer.Meta):
        fields = CustomerSerializer.Meta.fields + ["address", "note", "project_count"]


class CustomerWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Customer
        fields = [
            "code", "name", "tax_id", "contact_name", "contact_phone",
            "address", "payment_term_type", "payment_term_days", "note", "is_active",
        ]
        # 內建的 UniqueValidator 會先擋下來，吐出「包含 客戶代號 的 客戶 已經存在。」
        # 這句話沒告訴使用者是哪一個代號、也沒說該怎麼辦。改用自己寫的
        extra_kwargs = {"code": {"validators": []}}

    def validate_tax_id(self, value):
        if value and (not value.isdigit() or len(value) != 8):
            raise serializers.ValidationError("統一編號必須是 8 位數字")
        return value

    def validate_code(self, value):
        clash = Customer.objects.filter(code=value)
        if self.instance:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError(f"代號「{value}」已被使用")
        return value


class CustomerViewSet(BaseModelViewSet):
    """客戶。讀給全體（下拉選單），寫給經理與系統管理員。"""

    queryset = Customer.objects.all()
    serializer_class = CustomerDetailSerializer
    write_serializer_class = CustomerWriteSerializer
    read_permission = None
    write_permission = "manage_masters"

    def get_queryset(self):
        qs = super().get_queryset().annotate(project_count=Count("projects"))
        params = self.request.query_params
        if q := params.get("q"):
            qs = qs.filter(Q(name__icontains=q) | Q(code__icontains=q) | Q(tax_id__icontains=q))
        # 下拉選單只要啟用中的；維護頁要看得到停用的
        if params.get("active") != "false":
            qs = qs.filter(is_active=True) if params.get("active") == "true" else qs
        return qs.order_by("code")

    def perform_destroy(self, instance):
        # 有案子的客戶不能刪，只能停用——刪掉會讓歷史專案失去客戶資訊
        if instance.projects.exists():
            raise BusinessRuleError(
                f"「{instance.name}」底下有 {instance.projects.count()} 個專案，不可刪除。"
                "若不再往來，請改為「停用」——歷史資料要留著"
            )
        instance.delete()


# ── 廠商 ───────────────────────────────────────────────────────────
class VendorDetailSerializer(VendorSerializer):
    class Meta(VendorSerializer.Meta):
        fields = VendorSerializer.Meta.fields + [
            "vendor_types", "tax_id", "address", "payment_terms", "note",
        ]


class VendorWriteSerializer(serializers.ModelSerializer):
    # allow_empty=True 讓空陣列能進到 validate_vendor_types，
    # 才顯示得出「至少要選一種廠商類型」而不是「此列表不可為空」
    vendor_types = serializers.ListField(child=serializers.CharField(), allow_empty=True)

    class Meta:
        model = Vendor
        fields = [
            "code", "name", "vendor_types", "tax_id", "contact_name", "contact_phone",
            "address", "payment_terms", "note", "is_active",
        ]
        extra_kwargs = {"code": {"validators": []}}

    def validate_vendor_types(self, value):
        if not value:
            raise serializers.ValidationError("至少要選一種廠商類型")
        if invalid := set(value) - set(VendorType.values):
            raise serializers.ValidationError(f"未知的廠商類型：{'、'.join(invalid)}")
        return value

    def validate_code(self, value):
        clash = Vendor.objects.filter(code=value)
        if self.instance:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError(f"代號「{value}」已被使用")
        return value


class VendorViewSet(BaseModelViewSet):
    """廠商（供應商／分包商／外包加工／運輸行）。一家可以身兼多種。"""

    queryset = Vendor.objects.all()
    serializer_class = VendorDetailSerializer
    write_serializer_class = VendorWriteSerializer
    read_permission = None
    write_permission = "manage_masters"

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if q := params.get("q"):
            qs = qs.filter(Q(name__icontains=q) | Q(code__icontains=q))
        if vendor_type := params.get("type"):
            qs = qs.filter(vendor_types__contains=[vendor_type])
        if params.get("active") == "true":
            qs = qs.filter(is_active=True)
        return qs.order_by("code")

    def perform_destroy(self, instance):
        used = (
            instance.subcontracted_units.exists()
            or instance.subcontracts.exists()
            or instance.payables.exists()
        )
        if used:
            raise BusinessRuleError(
                f"「{instance.name}」已被工項或應付資料引用，不可刪除。若不再往來請改為「停用」"
            )
        instance.delete()


# ── 員工 ───────────────────────────────────────────────────────────
class EmployeeSerializer(serializers.ModelSerializer):
    """員工。

    ⚠️ 密碼不在這裡改。建立時給預設密碼並強制首次登入變更，
    忘記密碼走「重設密碼」動作——把密碼混進一般的編輯表單，
    很容易在「順手改個電話」的時候把別人的密碼也改掉。
    """

    department_name = serializers.CharField(source="department.name", read_only=True, default="")
    roles = serializers.SerializerMethodField()
    role_labels = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id", "username", "employee_no", "name", "title", "phone", "email",
            "department", "department_name", "roles", "role_labels",
            "is_active", "must_change_password", "last_login",
        ]

    def get_roles(self, obj) -> list[str]:
        return sorted(obj.role_codes)

    def get_role_labels(self, obj) -> list[str]:
        labels = dict(Role.choices)
        return [labels.get(c, c) for c in sorted(obj.role_codes)]


class EmployeeWriteSerializer(serializers.ModelSerializer):
    roles = serializers.ListField(
        child=serializers.ChoiceField(choices=Role.choices),
        allow_empty=True,  # 空陣列要進到 validate_roles 才顯示得出自己寫的訊息
        help_text="一個人可以掛多個角色，權限取聯集",
    )

    class Meta:
        model = User
        fields = [
            "username", "employee_no", "name", "title", "phone", "email",
            "department", "roles", "is_active",
        ]
        extra_kwargs = {"username": {"validators": []}}

    def validate_username(self, value):
        clash = User.objects.filter(username=value)
        if self.instance:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError(f"帳號「{value}」已被使用")
        return value

    def validate_roles(self, value):
        if not value:
            raise serializers.ValidationError(
                "至少要給一個角色。沒有角色的人登入後什麼都看不到"
            )
        return value

    @transaction.atomic
    def create(self, validated_data):
        roles = validated_data.pop("roles")
        user = User(**validated_data)
        user.set_password(DEFAULT_PASSWORD)
        user.must_change_password = True
        user.save()
        self._sync_roles(user, roles)
        return user

    @transaction.atomic
    def update(self, instance, validated_data):
        roles = validated_data.pop("roles", None)
        user = super().update(instance, validated_data)
        if roles is not None:
            self._sync_roles(user, roles)
        return user

    @staticmethod
    def _sync_roles(user, roles):
        from django.contrib.auth.models import Group

        user.groups.set([Group.objects.get_or_create(name=code)[0] for code in roles])


class EmployeeViewSet(BaseModelViewSet):
    """員工。

    ⚠️ 不提供刪除。離職的人要「停用」而不是刪掉——
    他做過的階段推進、簽收、請款異動都掛在他名下，刪了歷史就斷了。
    """

    queryset = User.objects.select_related("department").prefetch_related("groups")
    serializer_class = EmployeeSerializer
    write_serializer_class = EmployeeWriteSerializer
    read_permission = None
    write_permission = "manage_masters"
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if q := params.get("q"):
            qs = qs.filter(
                Q(name__icontains=q) | Q(username__icontains=q) | Q(employee_no__icontains=q)
            )
        if role := params.get("role"):
            qs = qs.filter(groups__name=role)
        if params.get("active") == "true":
            qs = qs.filter(is_active=True)
        return qs.order_by("employee_no", "username")

    @action(detail=True, methods=["post"], url_path="reset-password")
    def reset_password(self, request, pk=None):
        """把密碼重設回預設值，並要求對方下次登入時修改。"""
        from main.utils.permissions import has_permission

        if not has_permission(request.user, "manage_masters"):
            return Response(
                {"type": "permission_denied", "detail": "你沒有重設密碼的權限"},
                status=status.HTTP_403_FORBIDDEN,
            )

        user = self.get_object()
        new_password = request.data.get("password") or DEFAULT_PASSWORD
        try:
            validate_password(new_password, user)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"password": list(exc.messages)}) from exc

        user.set_password(new_password)
        user.must_change_password = True
        user.save(update_fields=["password", "must_change_password"])

        # 密碼被重設是資安事件，要留痕
        from main.apps.core.models import ActivityLog
        from main.utils.choices import ActivityCategory

        ActivityLog.record(
            f"{user.name}（{user.username}）的密碼被重設",
            ActivityCategory.SYSTEM, actor=request.user, obj=user,
        )
        return Response({
            "message": f"{user.name} 的密碼已重設，對方下次登入時必須自行修改",
            "password": new_password,
        })


class DepartmentSerializer(serializers.ModelSerializer):
    member_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Department
        fields = ["id", "code", "name", "parent", "manager", "is_active", "member_count"]


class DepartmentViewSet(BaseModelViewSet):
    queryset = Department.objects.all()
    serializer_class = DepartmentSerializer
    read_permission = None
    write_permission = "manage_masters"
    pagination_class = None

    def get_queryset(self):
        return super().get_queryset().annotate(member_count=Count("members")).order_by("code")


# ── 選項 ───────────────────────────────────────────────────────────
@extend_schema(
    responses=OpenApiTypes.OBJECT,
    description="所有列舉值與下拉選項。前端不必把「狀態有哪三種」再寫一遍",
)
class OptionsView(APIView):
    """GET /options —— 一次取完所有列舉值。

    後端改了列舉，前端跟著變，不會兩邊不同步。
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from main.apps.projects.models import Project
        from main.utils import choices as c
        from main.utils.scoping import scope_projects

        def opts(enum):
            return [{"value": v, "label": label} for v, label in enum.choices]

        return Response({
            "status": opts(c.Status),
            "project_lifecycle": opts(c.ProjectLifecycle),
            "flow_state": opts(c.FlowState),
            "unit_type": opts(c.UnitType),
            "milestone_state": opts(c.MilestoneState),
            "change_order_status": opts(c.ChangeOrderStatus),
            "attachment_category": opts(c.AttachmentCategory),
            "subcontract_category": opts(c.SubcontractCategory),
            "subcontract_status": opts(c.SubcontractStatus),
            "payment_term_type": opts(c.PaymentTermType),
            "payment_method": opts(c.PaymentMethod),
            "payable_state": opts(c.PayableState),
            "certainty": opts(c.Certainty),
            "role": opts(Role),
            "status_colors": c.STATUS_COLORS,
            "users": list(User.objects.filter(is_active=True).values(
                "id", "name", "employee_no"
            )),
            # D45：期別「負責收款的會計師」下拉——finance 角色的啟用帳號
            "accountants": list(
                User.objects.filter(is_active=True, groups__name="finance")
                .distinct().values("id", "name")
            ),
            # D45：工作項目狀態的建議清單——沿用大家之前新增過的字（頻率高的在前）
            "task_status_suggestions": self._task_status_suggestions(),
            # 下拉選單用，只回 id/code/name，不分頁——這是選單不是列表
            "projects": list(
                scope_projects(Project.objects.filter(is_closed=False), request.user)
                .values("id", "code", "name")[:200]
            ),
            # D55：已結案的案子單獨一份。表單不該讓人把新資料掛到結案的案子上，
            # 但「收支明細」要查得到它——收過的錢不會因為案子結了就消失
            "closed_projects": list(
                scope_projects(Project.objects.filter(is_closed=True), request.user)
                .values("id", "code", "name")[:200]
            ),
        })

    @staticmethod
    def _task_status_suggestions():
        from collections import Counter

        from main.apps.tracking.models import FlowTask

        counter = Counter()
        for statuses in FlowTask.objects.exclude(statuses=[]).values_list("statuses", flat=True):
            counter.update(s for s in statuses if isinstance(s, str))
        return [name for name, _ in counter.most_common(20)]


# ── 產能與成本的主檔（D52）────────────────────────────────────────
class WorkTypeViewSet(BaseModelViewSet):
    """工作類型標籤。讀給全體（分配表單的下拉），寫給能分配工作的人。"""

    queryset = WorkType.objects.all()
    serializer_class = WorkTypeSerializer
    pagination_class = None   # 下拉選單用的小主檔，整包給
    read_permission = None
    write_permission = "edit_tracking"

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.query_params.get("active") != "false":
            qs = qs.filter(is_active=True)
        return qs.order_by("id")

    def perform_destroy(self, instance):
        # 統計掛在類型上，用過就不能刪——刪了歷史工數會變孤兒
        if instance.assignments.exists():
            raise BusinessRuleError("這個類型已有工作分配使用，不能刪除；可改為停用")
        instance.delete()

    @action(detail=False, methods=["get"])
    def suggest(self, request):
        """?status=切割中 → 上次同工段用的類型（分配表單的預帶，D52 必選但幫填）。"""
        from main.apps.tracking.models import FlowTaskAssignment

        status_ = (request.query_params.get("status") or "").strip()
        work_type_id = None
        if status_:
            work_type_id = (
                FlowTaskAssignment.objects.filter(status=status_, work_type__isnull=False)
                .order_by("-id")
                .values_list("work_type_id", flat=True)
                .first()
            )
        return Response({"work_type": work_type_id})


class MaterialItemViewSet(BaseModelViewSet):
    """品項。讀給登入者，寫給能登應付款的人（會計登帳時要能即時新增）。"""

    queryset = MaterialItem.objects.all()
    serializer_class = MaterialItemSerializer
    pagination_class = None   # 同上——品項數十筆的量級
    read_permission = None
    write_permission = "edit_payable"

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if q := params.get("q"):
            qs = qs.filter(name__icontains=q)
        if params.get("active") != "false":
            qs = qs.filter(is_active=True)
        return qs.order_by("name")

    def perform_destroy(self, instance):
        if instance.payable_lines.exists():
            raise BusinessRuleError("這個品項已有應付明細使用，不能刪除；可改為停用")
        instance.delete()
