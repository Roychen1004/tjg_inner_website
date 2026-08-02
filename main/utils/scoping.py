"""
資料可見範圍

對應 `docs/01_營運流程盤點與角色權限.md` §9。

⚠️ 這是**後端過濾**，不是前端隱藏。範圍外的資料根本不會離開伺服器。
若使用者直接呼叫 API，也只會拿到自己該看的那些。

另一個原則（決策 T06）：範圍外的資料回 404 而非 403——
不讓人從錯誤碼推測「有這筆資料但我看不到」。
"""
from django.db.models import Q

from main.apps.core.models import Role
from main.utils.permissions import has_permission


def visible_project_ids(user):
    """這個使用者看得到哪些專案的完整資料。None 表示全部。"""
    if not user or not user.is_authenticated:
        return []
    if user.is_superuser or user.has_role(Role.OWNER, Role.ADMIN, Role.FINANCE):
        return None  # 全部
    if user.has_role(Role.PM):
        return list(user.owned_projects.values_list("pk", flat=True))
    if user.has_role(Role.SITE_MGR):
        # 自己派駐工地的專案＝有工項指派給自己的專案
        return list(
            user.assigned_units.values_list("project_id", flat=True).distinct()
        )
    return None  # 廠長、採購、品保、倉管：全部專案可見，但金額欄位另外過濾


def scope_projects(qs, user):
    """專案清單的可見範圍。

    專案比較特殊：非負責人也看得到案名與狀態（要協作），
    但看不到金額——金額由序列化器層過濾（見 can_view_amount）。
    """
    if not user or not user.is_authenticated:
        return qs.none()
    if user.is_superuser or user.has_role(Role.ADMIN, Role.OWNER, Role.FINANCE):
        return qs
    if user.has_role(Role.SITE_MGR):
        project_ids = user.assigned_units.values_list("project_id", flat=True)
        return qs.filter(pk__in=project_ids)
    if user.has_role(Role.WORKER) and not user.has_role(
        Role.PM, Role.PLANT_MGR, Role.PURCHASER, Role.QC, Role.WAREHOUSE
    ):
        return qs.none()  # 現場人員不看專案清單
    return qs


def scope_tracking_units(qs, user):
    """追蹤單元的可見範圍。

    現場人員只看得到指派給自己的——這是「我的工作」畫面的基礎。
    """
    if not user or not user.is_authenticated:
        return qs.none()
    if user.is_superuser or user.has_role(Role.ADMIN, Role.OWNER, Role.PM,
                                          Role.PLANT_MGR, Role.FINANCE,
                                          Role.PURCHASER, Role.QC, Role.WAREHOUSE):
        return qs
    if user.has_role(Role.SITE_MGR):
        project_ids = user.assigned_units.values_list("project_id", flat=True)
        return qs.filter(Q(project_id__in=project_ids) | Q(assignee=user))
    if user.has_role(Role.WORKER):
        return qs.filter(assignee=user)
    return qs.none()


def scope_billing(qs, user):
    """請款只有經營者、專案負責人、會計看得到"""
    if not user or not user.is_authenticated:
        return qs.none()
    if user.is_superuser or user.has_role(Role.ADMIN, Role.OWNER, Role.FINANCE):
        return qs
    if user.has_role(Role.PM):
        return qs.filter(project__owner=user)
    return qs.none()


def scope_activities(qs, user):
    """動態依專案可見範圍過濾"""
    if not user or not user.is_authenticated:
        return qs.none()
    ids = visible_project_ids(user)
    if ids is None:
        return qs
    return qs.filter(Q(project_id__in=ids) | Q(project__isnull=True))


def can_view_amount(user, project=None):
    """能不能看到金額。

    廠長、採購、品保、倉管看得到專案與批次，但看不到合約金額與請款——
    他們的工作不需要知道錢，知道了反而可能外流。
    """
    if not has_permission(user, "view_amounts"):
        return False
    if project is None:
        return True
    if user.is_superuser or user.has_role(Role.ADMIN, Role.OWNER, Role.FINANCE):
        return True
    # 專案負責人只看得到自己負責的案子的金額
    if user.has_role(Role.PM):
        return project.owner_id == user.pk
    return False


class ScopedQuerySetMixin:
    """ViewSet 用的 Mixin。

    用法：
        class ProjectViewSet(ScopedQuerySetMixin, ModelViewSet):
            scope_function = staticmethod(scope_projects)
    """

    scope_function = None

    def get_queryset(self):
        qs = super().get_queryset()
        if self.scope_function is None:
            return qs
        return self.scope_function(qs, self.request.user)
