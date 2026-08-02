from rest_framework.routers import DefaultRouter

from .views import ProductionLineViewSet

app_name = "production"

router = DefaultRouter(trailing_slash=False)
router.register("production-lines", ProductionLineViewSet, basename="production-line")

urlpatterns = router.urls
