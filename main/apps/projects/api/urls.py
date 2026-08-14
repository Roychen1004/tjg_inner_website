from rest_framework.routers import DefaultRouter

from .views import ChangeOrderViewSet, ProjectViewSet

app_name = "projects"

router = DefaultRouter(trailing_slash=False)
router.register("projects", ProjectViewSet, basename="project")
router.register("change-orders", ChangeOrderViewSet, basename="change-order")

urlpatterns = router.urls
