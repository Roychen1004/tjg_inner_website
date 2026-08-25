from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    FlowTaskAssignmentViewSet,
    FlowTaskViewSet,
    FlowUnitViewSet,
    StaffWorkloadView,
    StageTemplateViewSet,
    TrackingUnitViewSet,
)

app_name = "tracking"

router = DefaultRouter(trailing_slash=False)
router.register("flow-units", FlowUnitViewSet, basename="flow-unit")
router.register("flow-tasks", FlowTaskViewSet, basename="flow-task")
router.register("task-assignments", FlowTaskAssignmentViewSet, basename="task-assignment")
router.register("tracking-units", TrackingUnitViewSet, basename="tracking-unit")
router.register("stage-templates", StageTemplateViewSet, basename="stage-template")

urlpatterns = [
    path("staff-workload", StaffWorkloadView.as_view(), name="staff-workload"),
    *router.urls,
]
