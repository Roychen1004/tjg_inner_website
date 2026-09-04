from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    CashBalanceView,
    CashflowForecastView,
    CashLedgerView,
    PayableViewSet,
    ProjectPnlView,
    SubcontractViewSet,
)

app_name = "payables"

router = DefaultRouter(trailing_slash=False)
router.register("subcontracts", SubcontractViewSet, basename="subcontract")
router.register("payables", PayableViewSet, basename="payable")

urlpatterns = [
    path("cashflow/forecast", CashflowForecastView.as_view(), name="cashflow-forecast"),
    path("cashflow/ledger", CashLedgerView.as_view(), name="cashflow-ledger"),
    path("cashflow/cash-balance", CashBalanceView.as_view(), name="cash-balance"),
    path("projects/<int:pk>/pnl", ProjectPnlView.as_view(), name="project-pnl"),
    *router.urls,
]
