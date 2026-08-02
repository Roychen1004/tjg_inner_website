from django.db.models import Q
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from main.apps.masters.models import Customer, Item, Vendor
from main.apps.masters.serializers import CustomerSerializer, ItemSerializer, VendorSerializer
from main.utils.viewsets import ReadOnlyViewSet


class CustomerViewSet(ReadOnlyViewSet):
    """客戶（唯讀）。主檔維護走 Django Admin（決策 T03）。"""

    queryset = Customer.objects.filter(is_active=True)
    serializer_class = CustomerSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        if q := self.request.query_params.get("q"):
            qs = qs.filter(Q(name__icontains=q) | Q(code__icontains=q))
        return qs


class VendorViewSet(ReadOnlyViewSet):
    """廠商（唯讀）。分包商、外包加工、運輸行都在這裡。"""

    queryset = Vendor.objects.filter(is_active=True)
    serializer_class = VendorSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if q := params.get("q"):
            qs = qs.filter(Q(name__icontains=q) | Q(code__icontains=q))
        if vendor_type := params.get("type"):
            qs = qs.filter(vendor_types__contains=[vendor_type])
        return qs


class ItemViewSet(ReadOnlyViewSet):
    """物品主檔（唯讀）"""

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


@extend_schema(
    responses=OpenApiTypes.OBJECT,
    description="所有列舉值與下拉選項。前端不必把「狀態有哪三種」再寫一遍",
)
class OptionsView(APIView):
    """GET /options —— 所有列舉值與下拉選項，一次取完。

    前端不必把「狀態有哪三種、觸發方式有哪四種」再寫一遍——
    後端改了列舉，前端跟著變，不會兩邊不同步。
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from main.apps.core.models import Role, User
        from main.utils import choices as c

        def opts(enum):
            return [{"value": v, "label": label} for v, label in enum.choices]

        users = User.objects.filter(is_active=True).values("id", "name", "employee_no")
        projects = scoped_project_options(request.user)

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
            "users": list(users),
            "projects": projects,
        })


def scoped_project_options(user):
    """下拉選單用的專案清單。只回 id/code/name，不分頁——
    這是選單不是列表，本來就該短（決策 D07：不提供「取得全部」的通用端點）。"""
    from main.apps.projects.models import Project
    from main.utils.scoping import scope_projects

    qs = scope_projects(Project.objects.filter(is_closed=False), user)
    return list(qs.values("id", "code", "name", "project_type")[:200])
