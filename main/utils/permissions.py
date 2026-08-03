"""
功能權限與可見導航

對應 `docs/開發/01_業務流程與權限.md` §8 的權限矩陣。

分兩層：
  · 這裡（permissions）：能不能【用這個功能】
  · scoping.py：看得到【哪些資料】

⚠️ 前端拿到的 permissions 只是 UI 提示，用來決定按鈕顯不顯示。
真正的攔截一律在後端——DRF permission class 與 get_queryset()。
"""
from rest_framework.permissions import BasePermission

from main.apps.core.models import Role

# ── 功能權限 → 允許的角色 ─────────────────────────────────────────
# admin 與 superuser 一律通過，不必逐項列出
PERMISSION_ROLES = {
    # 專案
    "view_project": [Role.OWNER, Role.PM, Role.PLANT_MGR, Role.SITE_MGR,
                     Role.PURCHASER, Role.QC, Role.WAREHOUSE, Role.FINANCE, Role.HR],
    "create_project": [Role.OWNER, Role.PM],
    "edit_project": [Role.OWNER, Role.PM],
    "delete_project": [Role.OWNER],
    "advance_project_stage": [Role.OWNER, Role.PM],
    "approve_change_order": [Role.OWNER],

    # 追蹤單元
    "view_tracking": [Role.OWNER, Role.PM, Role.PLANT_MGR, Role.SITE_MGR,
                      Role.PURCHASER, Role.QC, Role.WAREHOUSE, Role.FINANCE, Role.WORKER],
    "create_tracking": [Role.OWNER, Role.PM, Role.PLANT_MGR, Role.SITE_MGR],
    "edit_tracking": [Role.OWNER, Role.PM, Role.PLANT_MGR, Role.SITE_MGR],
    "move_stage": [Role.OWNER, Role.PM, Role.PLANT_MGR, Role.SITE_MGR, Role.QC,
                   Role.WAREHOUSE, Role.WORKER],
    "report_progress": [Role.OWNER, Role.PM, Role.PLANT_MGR, Role.SITE_MGR, Role.WORKER],
    "record_signoff": [Role.OWNER, Role.PM, Role.PLANT_MGR, Role.SITE_MGR],
    # 決策 D19：總重量只有這三個角色能填
    "edit_weight": [Role.OWNER, Role.PM, Role.PLANT_MGR],

    # 請款
    "view_billing": [Role.OWNER, Role.PM, Role.FINANCE],
    "edit_milestone": [Role.OWNER, Role.PM, Role.FINANCE],
    "transition_claim": [Role.OWNER, Role.FINANCE],
    "unlock_weight_basis": [Role.OWNER],

    # 資產
    "view_assets": [Role.OWNER, Role.PM, Role.PLANT_MGR, Role.SITE_MGR,
                    Role.PURCHASER, Role.QC, Role.WAREHOUSE, Role.FINANCE],
    "edit_assets": [Role.OWNER, Role.WAREHOUSE, Role.PLANT_MGR],

    # 產線
    "view_lines": [Role.OWNER, Role.PM, Role.PLANT_MGR, Role.QC, Role.WORKER],
    "edit_lines": [Role.PLANT_MGR],

    # 儀表板與金額
    "view_dashboard": [Role.OWNER, Role.PM, Role.PLANT_MGR, Role.SITE_MGR,
                       Role.PURCHASER, Role.QC, Role.WAREHOUSE, Role.FINANCE, Role.HR],
    # ★ 誰看得到錢。現場人員完全看不到金額
    "view_amounts": [Role.OWNER, Role.PM, Role.FINANCE],

    # 系統
    "view_audit": [Role.OWNER, Role.FINANCE],
    # 客戶、廠商、員工的維護。經營者也能改——這三個是每週都會動的東西，
    # 為了改一個客戶電話要去找系統管理員，制度上不合理（決策 D26）
    "manage_masters": [Role.OWNER],
}

# ── 導航分頁 → 允許的角色 ─────────────────────────────────────────
NAV_ROLES = {
    "dashboard": ["view_dashboard"],
    "projects": ["view_project"],
    "tracking": ["view_tracking"],
    "billing": ["view_billing"],
    "lines": ["view_lines"],
    "assets": ["view_assets"],
    "settings": ["manage_masters"],   # 客戶、廠商、員工維護
    "my-work": None,   # 特殊處理：有被指派工作的人才顯示
}


def has_permission(user, code):
    """判斷使用者是否具備某項功能權限"""
    if not user or not user.is_authenticated:
        return False
    if user.is_superuser or user.has_role(Role.ADMIN):
        return True
    return user.has_role(*PERMISSION_ROLES.get(code, []))


def permission_map(user):
    """回傳全部功能權限的 True/False，給前端決定按鈕顯不顯示"""
    return {code: has_permission(user, code) for code in PERMISSION_ROLES}


def visible_nav(user):
    """回傳這個使用者看得到哪些導航分頁。

    現場人員只看得到「我的工作」——不是把其他分頁 disable，是根本不顯示。
    看到自己用不到的東西會增加認知負荷（決策 D09）。
    """
    if not user or not user.is_authenticated:
        return []

    nav = []
    # worker 而且沒有其他管理角色 → 只給「我的工作」
    is_pure_worker = user.has_role(Role.WORKER) and not user.has_role(
        Role.OWNER, Role.PM, Role.PLANT_MGR, Role.SITE_MGR, Role.ADMIN
    )
    if is_pure_worker:
        return ["my-work"]

    for key, required in NAV_ROLES.items():
        if key == "my-work":
            # 工地主任等會被指派工作的角色，也給「我的工作」
            if user.has_role(Role.SITE_MGR, Role.PLANT_MGR, Role.WORKER):
                nav.append(key)
            continue
        if any(has_permission(user, code) for code in required):
            nav.append(key)
    return nav


# ── DRF permission classes ────────────────────────────────────────
class HasPermission(BasePermission):
    """用法：在 ViewSet 上設 `required_permission = "move_stage"`"""

    message = "你沒有執行這項操作的權限"

    def has_permission(self, request, view):
        code = getattr(view, "required_permission", None)
        if code is None:
            return request.user and request.user.is_authenticated
        return has_permission(request.user, code)


class ReadWritePermission(BasePermission):
    """讀寫分開：`read_permission` 與 `write_permission`"""

    message = "你沒有執行這項操作的權限"
    SAFE = ("GET", "HEAD", "OPTIONS")

    def has_permission(self, request, view):
        code = getattr(
            view,
            "read_permission" if request.method in self.SAFE else "write_permission",
            None,
        )
        if code is None:
            return request.user and request.user.is_authenticated
        return has_permission(request.user, code)
