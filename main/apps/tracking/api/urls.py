from rest_framework.routers import DefaultRouter

from .views import StageTemplateViewSet, TrackingUnitViewSet

app_name = "tracking"

router = DefaultRouter(trailing_slash=False)
router.register("tracking-units", TrackingUnitViewSet, basename="tracking-unit")
router.register("stage-templates", StageTemplateViewSet, basename="stage-template")

urlpatterns = router.urls
