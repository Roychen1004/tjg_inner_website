from django.urls import path
from rest_framework.routers import DefaultRouter

from .views.masters import (
    CustomerAdminViewSet,
    DepartmentViewSet,
    EmployeeViewSet,
    VendorAdminViewSet,
)
from .views import CustomerViewSet, ItemViewSet, OptionsView, VendorViewSet

app_name = "masters"

router = DefaultRouter(trailing_slash=False)
# 唯讀的下拉用端點（全體員工可讀）
router.register("customers", CustomerViewSet, basename="customer")
router.register("vendors", VendorViewSet, basename="vendor")
router.register("items", ItemViewSet, basename="item")

# 主檔維護（經營者與系統管理員）
router.register("admin/customers", CustomerAdminViewSet, basename="admin-customer")
router.register("admin/vendors", VendorAdminViewSet, basename="admin-vendor")
router.register("admin/employees", EmployeeViewSet, basename="admin-employee")
router.register("admin/departments", DepartmentViewSet, basename="admin-department")

urlpatterns = [
    path("options", OptionsView.as_view(), name="options"),
    *router.urls,
]
