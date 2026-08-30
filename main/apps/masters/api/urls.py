from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    CustomerViewSet,
    DepartmentViewSet,
    EmployeeViewSet,
    FlowCatalogView,
    FlowItemViewSet,
    FlowTemplateViewSet,
    MaterialItemViewSet,
    OptionsView,
    VendorViewSet,
    WorkTypeViewSet,
)

app_name = "masters"

# 一張表一個端點。讀給全體（下拉選單），寫給經理與系統管理員——
# 靠 read_permission / write_permission 分，不是靠兩組網址
router = DefaultRouter(trailing_slash=False)
router.register("customers", CustomerViewSet, basename="customer")
router.register("vendors", VendorViewSet, basename="vendor")
router.register("employees", EmployeeViewSet, basename="employee")
router.register("departments", DepartmentViewSet, basename="department")
router.register("flow-templates", FlowTemplateViewSet, basename="flow-template")
router.register("flow-items", FlowItemViewSet, basename="flow-item")
router.register("work-types", WorkTypeViewSet, basename="work-type")
router.register("material-items", MaterialItemViewSet, basename="material-item")

urlpatterns = [
    path("options", OptionsView.as_view(), name="options"),
    path("flow-catalog", FlowCatalogView.as_view(), name="flow-catalog"),
    *router.urls,
]
