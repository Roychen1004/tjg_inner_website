"""
功能權限與可見導航

三種角色：
  經營者  什麼都能做
  會計    輸入與金流都能做；「核可付款」與「刪專案」這類拍板的事除外
  檢視    看得到案子與進度，看不到任何金額（含金額類附件）

分兩層：
  · 這裡（permissions）：能不能【用這個功能】
  · scoping.py：能不能【看到金額】

⚠️ 前端拿到的 permissions 只是 UI 提示，用來決定按鈕顯不顯示。
真正的攔截一律在後端——DRF permission class 與 get_queryset()。
"""
from rest_framework.permissions import BasePermission

from main.apps.core.models import Role

# ── 功能權限 → 允許的角色 ─────────────────────────────────────────
# superuser 一律通過，不必逐項列出
PERMISSION_ROLES = {
    # 金流（應收、應付、現金流、損益）：整個分頁只有這兩種角色看得到
    "view_money": [Role.OWNER, Role.FINANCE],

    # 專案與進度：辦公室的兩個人就是全部的輸入來源，兩人都能維護
    "edit_project": [Role.OWNER, Role.FINANCE],
    "edit_tracking": [Role.OWNER, Role.FINANCE],
    "delete_project": [Role.OWNER],
    "approve_change_order": [Role.OWNER],   # 牽涉合約金額，老闆拍板

    # 應收
    "edit_milestone": [Role.OWNER, Role.FINANCE],
    "transition_milestone": [Role.OWNER, Role.FINANCE],

    # 應付
    "edit_subcontract": [Role.OWNER, Role.FINANCE],
    "edit_payable": [Role.OWNER, Role.FINANCE],
    # ★ 核可與付款分開：同一個人不該既決定要付多少、又執行付款
    "approve_payable": [Role.OWNER],
    "pay_payable": [Role.OWNER, Role.FINANCE],

    # 主檔（客戶、廠商、員工、階段模板）
    "manage_masters": [Role.OWNER],
}

# 舊碼名的相容別名——view_amounts 散在序列化器與附件權限裡，
# 意義與 view_money 完全相同，不值得為改名動十個檔案
PERMISSION_ALIASES = {
    "view_amounts": "view_money",
    "view_billing": "view_money",
    "view_payables": "view_money",
    "view_cashflow": "view_money",
}

# ── 導航分頁 → 需要的權限（None＝所有登入者）──────────────────────
NAV_ROLES = {
    "dashboard": None,
    "projects": None,
    "tracking": None,   # 追蹤看板：跨案看「東西卡在哪一站」，不含金額
    "finance": ["view_money"],
    "settings": ["manage_masters"],
}


def has_permission(user, code):
    """判斷使用者是否具備某項功能權限"""
    if not user or not user.is_authenticated:
        return False
    if user.is_superuser:
        return True
    code = PERMISSION_ALIASES.get(code, code)
    return user.has_role(*PERMISSION_ROLES.get(code, []))


def permission_map(user):
    """回傳全部功能權限的 True/False，給前端決定按鈕顯不顯示"""
    return {code: has_permission(user, code) for code in PERMISSION_ROLES}


def visible_nav(user):
    """回傳這個使用者看得到哪些導航分頁。

    用不到的分頁根本不顯示，不是變灰——看到自己用不到的東西只是負荷。
    """
    if not user or not user.is_authenticated:
        return []
    return [
        key for key, required in NAV_ROLES.items()
        if required is None or any(has_permission(user, code) for code in required)
    ]


# ── DRF permission classes ────────────────────────────────────────
class HasPermission(BasePermission):
    """用法：在 ViewSet 上設 `required_permission = "edit_tracking"`"""

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
