from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import CashflowForecastView, PayableViewSet, ProjectPnlView, SubcontractViewSet

app_name = "payables"

router = DefaultRouter(trailing_slash=False)
router.register("subcontracts", SubcontractViewSet, basename="subcontract")
router.register("payables", PayableViewSet, basename="payable")

urlpatterns = [
    path("cashflow/forecast", CashflowForecastView.as_view(), name="cashflow-forecast"),
    path("projects/<int:pk>/pnl", ProjectPnlView.as_view(), name="project-pnl"),
    *router.urls,
]
