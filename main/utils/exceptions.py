"""
統一錯誤格式

依 API 規格 §3.5：所有錯誤回應長這樣
    {"type": "validation_error", "detail": "資料驗證失敗", "errors": [...]}

原則（決策 T06）：無權限的資料回 404 而非 403，
不讓使用者從錯誤碼推測「有這筆資料但我看不到」。
"""
import logging

from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.http import Http404
from rest_framework import status
from rest_framework.exceptions import APIException, NotAuthenticated, ValidationError
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

logger = logging.getLogger("tjg")


class BusinessRuleError(APIException):
    """業務規則違反，如「不可跳階」「重複簽收」"""

    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "操作不符合業務規則"
    default_code = "business_rule_error"


class ConfirmationRequired(APIException):
    """需要二次確認，如結案時尚有未收款"""

    status_code = status.HTTP_409_CONFLICT
    default_code = "confirmation_required"

    def __init__(self, detail, context=None, hint=None):
        super().__init__(detail)
        self.context = context or {}
        self.hint = hint or ""


class ConcurrencyConflict(APIException):
    """併發衝突，如階段已被他人變更"""

    status_code = status.HTTP_409_CONFLICT
    default_detail = "資料已被他人變更，請重新整理後再試"
    default_code = "conflict"


TYPE_BY_STATUS = {
    400: "validation_error",
    401: "authentication_failed",
    403: "permission_denied",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    413: "file_too_large",
    415: "unsupported_media_type",
    429: "throttled",
    500: "server_error",
}

FRIENDLY_DETAIL = {
    401: "登入已逾時，請重新登入",
    403: "你沒有執行這項操作的權限",
    404: "找不到資料",
    405: "不支援的操作方式",
    500: "系統發生錯誤，請聯絡管理員",
}


def _flatten_errors(detail, prefix=""):
    """把 DRF 巢狀的錯誤結構攤平成 [{field, code, message}]"""
    out = []
    if isinstance(detail, dict):
        for key, value in detail.items():
            field = f"{prefix}.{key}" if prefix else str(key)
            out.extend(_flatten_errors(value, field))
    elif isinstance(detail, list):
        for item in detail:
            out.extend(_flatten_errors(item, prefix))
    else:
        out.append({
            "field": prefix or "non_field_errors",
            "code": getattr(detail, "code", "invalid"),
            "message": str(detail),
        })
    return out


def tjg_exception_handler(exc, context):
    # Django 原生例外轉成 DRF 的
    if isinstance(exc, Http404):
        exc = APIException(FRIENDLY_DETAIL[404])
        exc.status_code = status.HTTP_404_NOT_FOUND
    elif isinstance(exc, DjangoPermissionDenied):
        exc = APIException(FRIENDLY_DETAIL[403])
        exc.status_code = status.HTTP_403_FORBIDDEN

    response = drf_exception_handler(exc, context)

    # DRF 對「未登入」預設回 403，因為 SessionAuthentication 不提供
    # WWW-Authenticate header。但語意上 401 才是「未認證」、403 是
    # 「已認證但無權限」——前端據此決定要顯示登入頁還是錯誤訊息。
    if response is not None and isinstance(exc, NotAuthenticated):
        response.status_code = status.HTTP_401_UNAUTHORIZED

    if response is None:
        # 未預期的例外：記錄完整堆疊，但不回傳給前端
        logger.exception("未處理的例外：%s", exc, exc_info=exc)
        return Response(
            {"type": "server_error", "detail": FRIENDLY_DETAIL[500]},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    code = response.status_code
    error_type = getattr(exc, "default_code", None) or TYPE_BY_STATUS.get(code, "error")

    body = {
        "type": error_type,
        "detail": FRIENDLY_DETAIL.get(code) or _extract_detail(exc, response),
    }

    if isinstance(exc, ValidationError):
        body["type"] = "validation_error"
        body["detail"] = "資料驗證失敗"
        body["errors"] = _flatten_errors(response.data)

    if isinstance(exc, ConfirmationRequired):
        body["context"] = exc.context
        body["hint"] = exc.hint

    if code == status.HTTP_429_TOO_MANY_REQUESTS:
        wait = getattr(exc, "wait", None)
        if wait:
            body["retry_after"] = int(wait)

    response.data = body
    return response


def _extract_detail(exc, response):
    detail = getattr(exc, "detail", None)
    if isinstance(detail, list | dict):
        return "資料驗證失敗"
    return str(detail) if detail else str(response.data)
