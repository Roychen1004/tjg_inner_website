"""
主檔 API

**一張表一個端點。** 客戶與廠商原本各有兩套 ViewSet——
一套唯讀給下拉選單、一套 CRUD 給維護頁——是不必要的分裂：
同一份資料兩個網址、兩個序列化器、兩處篩選邏輯要同步。

改成一個端點，讀寫用不同權限：
    read_permission  = view_project     全體員工都要用下拉
    write_permission = manage_masters   只有經營者與系統管理員能改

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
from main.apps.masters.models import Customer, Item, Vendor
from main.apps.masters.serializers import CustomerSerializer, ItemSerializer, VendorSerializer
from main.utils.choices import VendorType
from main.utils.exceptions import BusinessRuleError
from main.utils.viewsets import BaseModelViewSet, ReadOnlyViewSet

DEFAULT_PASSWORD = "28494320"


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
            "address", "note", "is_active",
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
    """客戶。讀給全體（下拉選單），寫給經營者與系統管理員。"""

    queryset = Customer.objects.all()
    serializer_class = CustomerDetailSerializer
    write_serializer_class = CustomerWriteSerializer
    read_permission = "view_project"
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
    read_permission = "view_project"
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
            or instance.outsourced_units.exists()
            or instance.transported_units.exists()
        )
        if used:
            raise BusinessRuleError(
                f"「{instance.name}」已被追蹤單元引用，不可刪除。若不再往來請改為「停用」"
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
    read_permission = "view_project"
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
    read_permission = "view_project"
    write_permission = "manage_masters"
    pagination_class = None

    def get_queryset(self):
        return super().get_queryset().annotate(member_count=Count("members")).order_by("code")


# ── 物品（唯讀）─────────────────────────────────────────────────────
class ItemViewSet(ReadOnlyViewSet):
    """物品主檔。

    維護留在 Django Admin：欄位依料型不同（鋼板問厚寬長、H型鋼問腹板翼板厚），
    Admin 的表單處理這種情況比自己刻一個好（決策 D26）。
    """

    queryset = Item.objects.filter(is_active=True).select_related("category")
    serializer_class = ItemSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if q := params.get("q"):
            qs = qs.filter(
                Q(name__icontains=q) | Q(code__icontains=q) | Q(spec_label__icontains=q)
            )
        if kind := params.get("kind"):
            qs = qs.filter(item_kind=kind)
        if mode := params.get("tracking_mode"):
            qs = qs.filter(tracking_mode=mode)
        return qs


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
            "project_type": opts(c.ProjectType),
            "unit_type": opts(c.UnitType),
            "work_mode": opts(c.WorkMode),
            "rollback_reason": opts(c.RollbackReason),
            "trigger_type": opts(c.TriggerType),
            "claim_state": opts(c.ClaimState),
            "milestone_state": opts(c.MilestoneState),
            "item_kind": opts(c.ItemKind),
            "asset_status": opts(c.AssetStatus),
            "asset_movement_type": opts(c.AssetMovementType),
            "lot_status": opts(c.LotStatus),
            "aging_status": opts(c.AgingStatus),
            "location_type": opts(c.LocationType),
            "line_status": opts(c.LineStatus),
            "profile_type": opts(c.ProfileType),
            "change_order_status": opts(c.ChangeOrderStatus),
            "role": opts(Role),
            "status_colors": c.STATUS_COLORS,
            "users": list(User.objects.filter(is_active=True).values(
                "id", "name", "employee_no"
            )),
            # 下拉選單用，只回 id/code/name，不分頁——這是選單不是列表
            "projects": list(
                scope_projects(Project.objects.filter(is_closed=False), request.user)
                .values("id", "code", "name", "project_type")[:200]
            ),
        })
