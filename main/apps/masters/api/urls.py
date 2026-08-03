from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    CustomerViewSet,
    DepartmentViewSet,
    EmployeeViewSet,
    ItemViewSet,
    OptionsView,
    VendorViewSet,
)

app_name = "masters"

# 一張表一個端點。讀給全體（下拉選單），寫給經營者與系統管理員——
# 靠 read_permission / write_permission 分，不是靠兩組網址
router = DefaultRouter(trailing_slash=False)
router.register("customers", CustomerViewSet, basename="customer")
router.register("vendors", VendorViewSet, basename="vendor")
router.register("employees", EmployeeViewSet, basename="employee")
router.register("departments", DepartmentViewSet, basename="department")
router.register("items", ItemViewSet, basename="item")

urlpatterns = [
    path("options", OptionsView.as_view(), name="options"),
    *router.urls,
]
