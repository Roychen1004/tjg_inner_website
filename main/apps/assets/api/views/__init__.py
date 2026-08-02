from django.db import transaction
from django.db.models import Count, Q, Sum
from django.shortcuts import get_object_or_404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from main.apps.assets.models import AssetMovement, AssetUnit
from main.apps.assets.serializers import (
    AssetMovementSerializer,
    AssetMoveSerializer,
    AssetUnitSerializer,
    AssetUnitWriteSerializer,
)
from main.apps.inventory.models import Location, Lot
from main.apps.inventory.serializers import (
    LocationSerializer,
    LotAdjustSerializer,
    LotIssueSerializer,
    LotReceiveSerializer,
    LotSerializer,
    StockTransactionSerializer,
)
from main.utils.choices import AgingStatus, AssetStatus, ItemKind, LotStatus
from main.utils.permissions import HasPermission
from main.utils.viewsets import BaseModelViewSet, ReadOnlyViewSet, bool_param

ASSET_SELECT = ("item", "location", "location__parent", "holder", "current_project")
LOT_SELECT = ("item", "location", "location__parent", "reserved_for_project", "parent_lot")


class AssetUnitViewSet(BaseModelViewSet):
    """個體型資產 —— 工具與設備。

    問的問題是「在誰手上、用在哪個案子、該校驗了沒」，
    與建材（問「還剩多少」）根本不同，所以是兩個端點而不是一個。
    """

    queryset = AssetUnit.objects.filter(is_active=True).select_related(*ASSET_SELECT)
    serializer_class = AssetUnitSerializer
    write_serializer_class = AssetUnitWriteSerializer
    read_permission = "view_assets"
    write_permission = "edit_assets"

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if q := params.get("q"):
            qs = qs.filter(
                Q(asset_no__icontains=q) | Q(item__name__icontains=q)
                | Q(brand__icontains=q) | Q(model__icontains=q) | Q(serial_no__icontains=q)
            )
        if kind := params.get("kind"):
            qs = qs.filter(item__item_kind=kind)
        if st := params.get("status"):
            qs = qs.filter(asset_status__in=st.split(","))
        if location := params.get("location"):
            qs = qs.filter(location_id=location)
        if project := params.get("project"):
            qs = qs.filter(current_project_id=project)
        if holder := params.get("holder"):
            qs = qs.filter(holder_id=holder)
        if bool_param(self.request, "due"):
            from django.utils import timezone

            today = timezone.localdate()
            qs = qs.filter(
                Q(calibration_due_date__lte=today) | Q(next_maintenance_date__lte=today)
            )
        return qs

    @extend_schema(request=AssetMoveSerializer, responses=AssetUnitSerializer)
    @action(detail=True, methods=["post"])
    def move(self, request, pk=None):
        """派用／歸還／移轉／送修。

        一個動作同時改位置、持有人、專案三者，並留下不可竄改的異動紀錄——
        「這支扭力扳手上個月在誰手上」要查得到。
        """
        asset = self.get_object()
        serializer = AssetMoveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        from main.apps.core.models import ActivityLog, User
        from main.utils.choices import ActivityCategory, AssetMovementType

        move_type = data["movement_type"]
        if move_type not in AssetMovementType.values:
            return Response(
                {"type": "validation_error", "detail": f"未知的異動類型：{move_type}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            from_location, from_holder, from_project = (
                asset.location, asset.holder, asset.current_project,
            )

            if data.get("to_location"):
                asset.location = Location.objects.get(pk=data["to_location"])
            if "to_holder" in data:
                asset.holder = (
                    User.objects.filter(pk=data["to_holder"]).first()
                    if data["to_holder"] else None
                )
            if "to_project" in data:
                from main.apps.projects.models import Project

                asset.current_project = (
                    Project.objects.filter(pk=data["to_project"]).first()
                    if data["to_project"] else None
                )

            # 狀態由異動類型推導，不讓使用者另外選——選錯就對不上了
            asset.asset_status = {
                AssetMovementType.ASSIGN: AssetStatus.IN_USE,
                AssetMovementType.RETURN: AssetStatus.IDLE,
                AssetMovementType.LEND: AssetStatus.LENT,
                AssetMovementType.MAINTENANCE_IN: AssetStatus.MAINTENANCE,
                AssetMovementType.MAINTENANCE_OUT: AssetStatus.IDLE,
                AssetMovementType.CALIBRATE: AssetStatus.CALIBRATION,
                AssetMovementType.SCRAP: AssetStatus.SCRAPPED,
                AssetMovementType.LOST: AssetStatus.LOST,
            }.get(move_type, asset.asset_status)
            asset.save()

            movement = AssetMovement.objects.create(
                asset=asset, movement_type=move_type,
                from_location=from_location, to_location=asset.location,
                from_holder=from_holder, to_holder=asset.holder,
                from_project=from_project, to_project=asset.current_project,
                operator=request.user, note=data.get("note", ""),
            )
            ActivityLog.record(
                f"{asset.asset_no} {asset.item.name} "
                f"{dict(AssetMovementType.choices)[move_type]}"
                + (f" → {asset.holder.name}" if asset.holder else "")
                + (f"（{asset.current_project.name}）" if asset.current_project else ""),
                ActivityCategory.ASSET, actor=request.user,
                project=asset.current_project, obj=asset,
            )

        return Response({
            "asset": AssetUnitSerializer(asset, context=self.get_serializer_context()).data,
            "movement": AssetMovementSerializer(movement).data,
        })

    @action(detail=True, methods=["get"])
    def movements(self, request, pk=None):
        asset = self.get_object()
        logs = AssetMovement.objects.filter(asset=asset).select_related(
            "from_location", "to_location", "from_holder", "to_holder", "to_project", "operator"
        )[:50]
        return Response(AssetMovementSerializer(logs, many=True).data)


class LotViewSet(BaseModelViewSet):
    """數量型庫存 —— 建材與零件耗材。

    帶出型號、材質、長寬高與實際餘料尺寸，
    因為「找一支 6M 以上的 H300 餘料」是每天實際會發生的查詢。
    """

    queryset = Lot.objects.select_related(*LOT_SELECT)
    serializer_class = LotSerializer
    read_permission = "view_assets"
    write_permission = "edit_assets"
    # 沒有 PUT／PATCH／DELETE：**庫存數量只能透過異動紀錄改變**。
    # 開放直接改數字，半年後就會變成「帳面 300 支、實際 180 支，沒人知道差額去哪」。
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if q := params.get("q"):
            qs = qs.filter(
                Q(lot_no__icontains=q) | Q(item__name__icontains=q)
                | Q(item__code__icontains=q) | Q(item__spec_label__icontains=q)
                | Q(heat_no__icontains=q) | Q(mill_cert_no__icontains=q)
            )
        if kind := params.get("kind"):
            qs = qs.filter(item__item_kind=kind)
        if st := params.get("status"):
            qs = qs.filter(status__in=st.split(","))
        if location := params.get("location"):
            qs = qs.filter(location_id=location)
        if project := params.get("project"):
            qs = qs.filter(
                Q(reserved_for_project_id=project) | Q(location__project_id=project)
            )
        if aging := params.get("aging"):
            qs = qs.filter(aging_status__in=aging.split(","))
        if profile := params.get("profile_type"):
            qs = qs.filter(item__profile_type=profile)

        remnant = bool_param(self.request, "remnant")
        if remnant is not None:
            qs = qs.filter(is_remnant=remnant)
        if bool_param(self.request, "available"):
            qs = qs.filter(status=LotStatus.AVAILABLE, qty_on_hand__gt=0)

        # 找料：?min_length=6000 找得到長度夠的餘料
        if min_length := params.get("min_length"):
            qs = qs.filter(
                Q(actual_length_mm__gte=min_length)
                | Q(actual_length_mm__isnull=True, item__length_mm__gte=min_length)
            )
        return qs.order_by("item__code", "lot_no")

    @action(detail=True, methods=["get"])
    def transactions(self, request, pk=None):
        """這一批的出入庫歷程"""
        lot = self.get_object()
        txns = lot.transactions.select_related(
            "from_location", "to_location", "project", "operator", "lot__item"
        )[:50]
        return Response(StockTransactionSerializer(txns, many=True).data)

    @extend_schema(request=LotReceiveSerializer, responses=LotSerializer)
    def create(self, request, *args, **kwargs):
        """入庫建檔。

        建立批號的同時寫一筆入庫異動——兩者在同一個交易裡，
        不會出現「有庫存但查不到怎麼來的」。
        """
        serializer = LotReceiveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        from main.apps.inventory.services import stock_service
        from main.apps.masters.models import Item
        from main.apps.projects.models import Project

        lot = stock_service.receive(
            item=get_object_or_404(Item, pk=data["item"], is_active=True),
            location=get_object_or_404(Location, pk=data["location"], is_active=True),
            qty=data["qty"],
            operator=request.user,
            lot_no=data.get("lot_no", ""),
            unit_cost=data.get("unit_cost"),
            mill_cert_no=data.get("mill_cert_no", ""),
            heat_no=data.get("heat_no", ""),
            source_po_no=data.get("source_po_no", ""),
            reserved_for_project=(
                Project.objects.filter(pk=data["reserved_for_project"]).first()
                if data.get("reserved_for_project") else None
            ),
            received_date=data.get("received_date"),
            note=data.get("note", ""),
        )
        return Response(
            LotSerializer(lot, context=self.get_serializer_context()).data,
            status=status.HTTP_201_CREATED,
        )

    @extend_schema(request=LotAdjustSerializer, responses=LotSerializer)
    @action(detail=True, methods=["post"])
    def adjust(self, request, pk=None):
        """盤點調整"""
        from main.apps.inventory.services import stock_service

        serializer = LotAdjustSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        lot = stock_service.adjust(
            lot=self.get_object(), operator=request.user,
            new_qty=serializer.validated_data["new_qty"],
            note=serializer.validated_data["note"],
        )
        return Response(LotSerializer(lot, context=self.get_serializer_context()).data)

    @extend_schema(request=LotIssueSerializer, responses=LotSerializer)
    @action(detail=True, methods=["post"])
    def issue(self, request, pk=None):
        """領用出庫"""
        from main.apps.inventory.services import stock_service
        from main.apps.projects.models import Project
        from main.apps.tracking.models import TrackingUnit

        serializer = LotIssueSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        lot = stock_service.issue(
            lot=self.get_object(), qty=data["qty"], operator=request.user,
            project=(
                Project.objects.filter(pk=data["project"]).first()
                if data.get("project") else None
            ),
            tracking_unit=(
                TrackingUnit.objects.filter(pk=data["tracking_unit"]).first()
                if data.get("tracking_unit") else None
            ),
            note=data.get("note", ""),
        )
        return Response(LotSerializer(lot, context=self.get_serializer_context()).data)


class LocationViewSet(ReadOnlyViewSet):
    """位置階層。倉庫→儲位、工地、外包廠、車輛。"""

    queryset = Location.objects.filter(is_active=True).select_related(
        "parent", "project", "vendor"
    )
    serializer_class = LocationSerializer
    pagination_class = None

    def get_queryset(self):
        qs = super().get_queryset()
        if lt := self.request.query_params.get("type"):
            qs = qs.filter(location_type__in=lt.split(","))
        return qs.order_by("location_type", "code")


def build_asset_summary():
    """資產總覽的統計卡片。

    刻意分開四種物品類型統計——「公司有多少東西」這個問題，
    工具的答案是「幾支」，建材的答案是「幾噸／多少錢」，不能混在一起數。
    """
    units = AssetUnit.objects.filter(is_active=True)
    lots = Lot.objects.exclude(status=LotStatus.SCRAPPED)

    by_kind = {}
    for kind, label in ItemKind.choices:
        if kind in (ItemKind.TOOL, ItemKind.EQUIPMENT):
            qs = units.filter(item__item_kind=kind)
            by_kind[kind] = {
                "label": label, "mode": "individual",
                "count": qs.count(),
                "in_use": qs.filter(asset_status=AssetStatus.IN_USE).count(),
                "idle": qs.filter(asset_status=AssetStatus.IDLE).count(),
                "unavailable": qs.filter(
                    asset_status__in=[
                        AssetStatus.MAINTENANCE, AssetStatus.CALIBRATION,
                        AssetStatus.LOST, AssetStatus.SCRAPPED,
                    ]
                ).count(),
            }
        else:
            qs = lots.filter(item__item_kind=kind)
            agg = qs.aggregate(qty=Sum("qty_on_hand"), value=Sum("total_value"), lots=Count("id"))
            by_kind[kind] = {
                "label": label, "mode": "quantity",
                "count": agg["lots"] or 0,
                "qty_on_hand": str(agg["qty"] or 0),
                "total_value": str(agg["value"] or 0),
                "remnant_lots": qs.filter(is_remnant=True).count(),
            }

    from django.utils import timezone

    today = timezone.localdate()
    stagnant = lots.filter(
        aging_status__in=[AgingStatus.STAGNANT, AgingStatus.DEAD, AgingStatus.SCRAP_CANDIDATE]
    )
    return {
        "by_kind": by_kind,
        "alerts": {
            "calibration_due": units.filter(calibration_due_date__lte=today).count(),
            "maintenance_due": units.filter(next_maintenance_date__lte=today).count(),
            "lost": units.filter(asset_status=AssetStatus.LOST).count(),
            "stagnant_lots": stagnant.count(),
            "stagnant_value": str(stagnant.aggregate(v=Sum("total_value"))["v"] or 0),
        },
        "by_location": [
            {"name": row["location__name"], "lots": row["n"]}
            for row in lots.values("location__name").annotate(n=Count("id")).order_by("-n")[:8]
        ],
    }


@extend_schema(responses=OpenApiTypes.OBJECT, description="資產總覽統計卡片")
class AssetSummaryView(APIView):
    """GET /assets/summary —— 資產總覽頁的統計卡片"""

    permission_classes = [IsAuthenticated, HasPermission]
    required_permission = "view_assets"

    def get(self, request):
        return Response(build_asset_summary())
