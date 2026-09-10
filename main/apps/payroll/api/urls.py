from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    HolidayViewSet,
    InsuranceGradeViewSet,
    PayrollLineViewSet,
    PayrollPeriodViewSet,
    PayrollPolicyView,
    PayrollRecordViewSet,
    PayrollReferenceView,
    SalaryProfileViewSet,
)

app_name = "payroll"

router = DefaultRouter(trailing_slash=False)
router.register("payroll-grades", InsuranceGradeViewSet, basename="payroll-grade")
router.register("payroll-holidays", HolidayViewSet, basename="payroll-holiday")
router.register("salary-profiles", SalaryProfileViewSet, basename="salary-profile")
router.register("payroll-periods", PayrollPeriodViewSet, basename="payroll-period")
router.register("payroll-records", PayrollRecordViewSet, basename="payroll-record")
router.register("payroll-lines", PayrollLineViewSet, basename="payroll-line")

urlpatterns = [
    path("payroll-policy", PayrollPolicyView.as_view(), name="payroll-policy"),
    path("payroll-references", PayrollReferenceView.as_view(), name="payroll-references"),
    *router.urls,
]
