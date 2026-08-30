from django.urls import path

from .views import ActivityFeedView, DashboardAttentionView, DashboardOverviewView
from .views.stats import FlowCostStatsView, ProductivityStatsView, UnitPriceStatsView

app_name = "analytics"

urlpatterns = [
    path("dashboard/overview", DashboardOverviewView.as_view(), name="dashboard-overview"),
    path("dashboard/attention", DashboardAttentionView.as_view(), name="dashboard-attention"),
    path("dashboard/activities", ActivityFeedView.as_view(), name="dashboard-activities"),
    # 產能與成本統計（D52）
    path("stats/productivity", ProductivityStatsView.as_view(), name="stats-productivity"),
    path("stats/unit-prices", UnitPriceStatsView.as_view(), name="stats-unit-prices"),
    path("stats/flow-costs", FlowCostStatsView.as_view(), name="stats-flow-costs"),
]
