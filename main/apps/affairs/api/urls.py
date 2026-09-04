from rest_framework.routers import DefaultRouter

from .views import AffairCategoryViewSet, AffairRuleViewSet, AffairTaskViewSet

app_name = "affairs"

router = DefaultRouter(trailing_slash=False)
router.register("affair-categories", AffairCategoryViewSet, basename="affair-category")
router.register("affair-rules", AffairRuleViewSet, basename="affair-rule")
router.register("affair-tasks", AffairTaskViewSet, basename="affair-task")

urlpatterns = router.urls
