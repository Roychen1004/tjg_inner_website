from rest_framework.routers import DefaultRouter

from .views import BillingMilestoneViewSet

app_name = "billing"

router = DefaultRouter(trailing_slash=False)
router.register("billing-milestones", BillingMilestoneViewSet, basename="billing-milestone")

urlpatterns = router.urls
