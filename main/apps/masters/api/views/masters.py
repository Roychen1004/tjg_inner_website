"""
主檔維護 API

原本主檔一律走 Django Admin（決策 T03）。實際使用後改了一半：

  客戶、廠商、員工 —— **搬到前端**。這三個是老闆與行政每週都會動的東西，
                      為了改一個客戶電話要跳到另一個介面、面對另一套操作邏輯，
                      是把系統的複雜度轉嫁給使用者。

  物品、位置、階段模板 —— **留在 Admin**。欄位多（物品依料型有不同尺寸欄位）、
                          動的頻率低，Admin 的表單處理得比自己刻的好。

判準：**動得頻繁、欄位少的搬前端；動得少、欄位多的留 Admin。**
"""
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Count, Q
from rest_framework import serializers, status
from rest_framework.decorators import action
from rest_framework.response import Response

from main.apps.core.models import Department, Role, User
from main.apps.masters.models import Customer, Vendor
from main.apps.masters.serializers import CustomerSerializer, VendorSerializer
from main.utils.exceptions import BusinessRuleError
from main.utils.viewsets import BaseModelViewSet

DEFAULT_PASSWORD = "28494320"


# ── 客戶 ───────────────────────────────────────────────────────────
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


class CustomerDetailSerializer(CustomerSerializer):
    project_count = serializers.IntegerField(read_only=True)

    class Meta(CustomerSerializer.Meta):
        fields = CustomerSerializer.Meta.fields + ["address", "note", "project_count"]


class CustomerAdminViewSet(BaseModelViewSet):
    """客戶維護"""

    queryset = Customer.objects.all()
    serializer_class = CustomerDetailSerializer
    write_serializer_class = CustomerWriteSerializer
    read_permission = "view_project"
    write_permission = "manage_masters"

    def get_queryset(self):
        qs = super().get_queryset().annotate(project_count=Count("projects"))
        if q := self.request.query_params.get("q"):
            qs = qs.filter(Q(name__icontains=q) | Q(code__icontains=q) | Q(tax_id__icontains=q))
        if self.request.query_params.get("active") == "true":
            qs = qs.filter(is_active=True)
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
        from main.utils.choices import VendorType

        if not value:
            raise serializers.ValidationError("至少要選一種廠商類型")
        invalid = set(value) - set(VendorType.values)
        if invalid:
            raise serializers.ValidationError(f"未知的廠商類型：{'、'.join(invalid)}")
        return value

    def validate_code(self, value):
        clash = Vendor.objects.filter(code=value)
        if self.instance:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError(f"代號「{value}」已被使用")
        return value


class VendorDetailSerializer(VendorSerializer):
    class Meta(VendorSerializer.Meta):
        fields = VendorSerializer.Meta.fields + [
            "vendor_types", "tax_id", "address", "payment_terms", "note",
        ]


class VendorAdminViewSet(BaseModelViewSet):
    """廠商維護（供應商／分包商／外包加工／運輸行）"""

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

        groups = [Group.objects.get_or_create(name=code)[0] for code in roles]
        user.groups.set(groups)


class EmployeeViewSet(BaseModelViewSet):
    """員工維護。

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
