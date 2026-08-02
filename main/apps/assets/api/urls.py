from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import AssetSummaryView, AssetUnitViewSet, LocationViewSet, LotViewSet

app_name = "assets"

router = DefaultRouter(trailing_slash=False)
router.register("assets", AssetUnitViewSet, basename="asset")
router.register("lots", LotViewSet, basename="lot")
router.register("locations", LocationViewSet, basename="location")

urlpatterns = [
    path("assets/summary", AssetSummaryView.as_view(), name="asset-summary"),
    *router.urls,
]
