"""
資料可見範圍

公司就一間——**資料範圍不再按角色切**，
登入就看得到全部案子與進度。唯一的界線是錢：

  · 「員工」與「檢視」拿到的 JSON 裡金額欄位是 null——值根本沒離開伺服器
  · 金流分頁與 API（應收/應付/現金流）只對經理與會計師開放
  · 合約、發票類附件對員工與檢視不可見也不可下載（欄位擋了、檔案沒擋，等於沒擋）

若之後要再切範圍（例如某人只看某幾案），改這一個檔就好——
所有 ViewSet 都經過這裡的 scope 函式。
"""


def _authenticated(qs, user):
    if not user or not user.is_authenticated:
        return qs.none()
    return qs


# 各資料型別目前共用同一條規則；名字留著，是為了讓呼叫端語意清楚、
# 也讓未來要各自收緊時不用回頭改呼叫端
scope_projects = _authenticated
scope_tracking_units = _authenticated
scope_billing = _authenticated
scope_payables = _authenticated
scope_activities = _authenticated
# 行政事項（D53）：老闆定的——每個帳號都看得到全部行政任務
scope_affairs = _authenticated


def can_view_amount(user, project=None):
    """能不能看到金額。員工與檢視一律看不到，不分專案。"""
    from main.utils.permissions import has_permission

    return has_permission(user, "view_money")


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
