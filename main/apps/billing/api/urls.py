from rest_framework.routers import DefaultRouter

from .views import BillingClaimViewSet, BillingMilestoneViewSet

app_name = "billing"

router = DefaultRouter(trailing_slash=False)
router.register("billing-milestones", BillingMilestoneViewSet, basename="billing-milestone")
router.register("billing-claims", BillingClaimViewSet, basename="billing-claim")

urlpatterns = router.urls
