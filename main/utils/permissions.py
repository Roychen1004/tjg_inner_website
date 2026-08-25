"""
功能權限與可見導航

四種角色（2026-08-18 D40 權限矩陣，依老闆指示重訂）：
  經理    什麼頁面都看得到、什麼都能改（系統管理員＝superuser，權限相同）
  會計師  什麼頁面都看得到，但只能改金流（應收、應付、付款）與自己的任務
  員工    繪圖師、行政人員、工廠員工——除了金流每一頁都看得到，
          但全部唯讀；唯一能動的是「我的任務」裡指派給自己的單元
  檢視    保留備用：同「員工」的唯讀範圍，但不會被指派任務

分兩層：
  · 這裡（permissions）：能不能【用這個功能】
  · scoping.py：能不能【看到金額】——員工與檢視在任何頁面都拿不到金額欄位

⚠️ 員工對「自己的單元」的操作權不在這張表——那是資料層的關係
（unit.assignee == user），檢查在 flow_service.can_operate。

⚠️ 前端拿到的 permissions 只是 UI 提示，用來決定按鈕顯不顯示。
真正的攔截一律在後端——DRF permission class 與 get_queryset()。
"""
from rest_framework.permissions import BasePermission

from main.apps.core.models import Role

# ── 功能權限 → 允許的角色 ─────────────────────────────────────────
# superuser 一律通過，不必逐項列出
PERMISSION_ROLES = {
    # 總覽與專案清單：所有角色都看得到（金額另由 view_money 擋）
    "view_overview": [Role.OWNER, Role.FINANCE, Role.STAFF, Role.VIEWER],
    # 我的任務：有可能被指派任務的人
    "view_mywork": [Role.OWNER, Role.FINANCE, Role.STAFF],

    # 金流（應收、應付、現金流、損益）：整個分頁只有這兩種角色看得到
    "view_money": [Role.OWNER, Role.FINANCE],

    # 專案與進度：只有經理（與系統管理員）能改——
    # 會計師的編輯範圍限金流，員工全部唯讀（D40）
    "edit_project": [Role.OWNER],
    "edit_tracking": [Role.OWNER],
    "delete_project": [Role.OWNER],
    "approve_change_order": [Role.OWNER],   # 牽涉合約金額，經理拍板

    # 應收（金流頁）：會計師的日常
    "edit_milestone": [Role.OWNER, Role.FINANCE],
    "transition_milestone": [Role.OWNER, Role.FINANCE],

    # 應付（金流頁）
    "edit_subcontract": [Role.OWNER, Role.FINANCE],
    "edit_payable": [Role.OWNER, Role.FINANCE],
    # ★ 核可與付款分開：同一個人不該既決定要付多少、又執行付款
    "approve_payable": [Role.OWNER],
    "pay_payable": [Role.OWNER, Role.FINANCE],

    # 主檔（客戶、廠商、員工）：頁面大家都看得到，改只有經理能改
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
    "dashboard": ["view_overview"],
    "projects": ["view_overview"],
    "tracking": None,   # 追蹤看板：跨案看「東西卡在哪一站」，不含金額
    "mywork": ["view_mywork"],
    "finance": ["view_money"],
    # 設定：頁面所有人都看得到（查同事分機、客戶聯絡人），
    # 新增／修改的按鈕跟著 manage_masters 走（D40）
    "settings": None,
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
