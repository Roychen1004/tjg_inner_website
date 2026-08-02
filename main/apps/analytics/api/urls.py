from django.urls import path

from .views import ActivityFeedView, DashboardAttentionView, DashboardOverviewView

app_name = "analytics"

urlpatterns = [
    path("dashboard/overview", DashboardOverviewView.as_view(), name="dashboard-overview"),
    path("dashboard/attention", DashboardAttentionView.as_view(), name="dashboard-attention"),
    path("dashboard/activities", ActivityFeedView.as_view(), name="dashboard-activities"),
]
