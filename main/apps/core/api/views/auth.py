"""
認證端點

用 Session Cookie 而非 JWT（決策 T02）：前後端同網域，
不用處理過期與 refresh；HttpOnly cookie 讓 XSS 偷不走。
"""
import logging

from django.contrib.auth import authenticate, login, logout, update_session_auth_hash
from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from main.apps.core.serializers.user import (
    ChangePasswordSerializer,
    CurrentUserSerializer,
    LoginSerializer,
)
from main.utils.throttling import LoginThrottle

logger = logging.getLogger("tjg")


@method_decorator(ensure_csrf_cookie, name="get")
class CsrfView(APIView):
    """GET /auth/csrf — 種下 csrftoken cookie

    前端啟動時呼叫一次。之後所有寫入操作都要帶 X-CSRFToken header。
    """

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = []

    @extend_schema(summary="取得 CSRF token", tags=["認證"], responses={200: None})
    def get(self, request):
        return Response({"csrf_token": get_token(request)})


class LoginView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [LoginThrottle]

    @extend_schema(
        summary="登入",
        description="成功後種下 session cookie，並回傳角色、功能權限、可見導航與預設首頁。",
        request=LoginSerializer,
        responses={
            200: CurrentUserSerializer,
            401: OpenApiResponse(description="帳號或密碼錯誤"),
            429: OpenApiResponse(description="嘗試次數過多"),
        },
        tags=["認證"],
    )
    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # django-axes 需要 request 才能記錄失敗來源
        user = authenticate(
            request,
            username=serializer.validated_data["username"],
            password=serializer.validated_data["password"],
        )
        if user is None:
            # 不透露究竟是帳號錯還是密碼錯
            logger.warning("登入失敗：%s", serializer.validated_data["username"])
            return Response(
                {"type": "authentication_failed", "detail": "帳號或密碼錯誤"},
                status=status.HTTP_401_UNAUTHORIZED,
            )
        if not user.is_active:
            return Response(
                {"type": "authentication_failed", "detail": "此帳號已停用，請聯絡管理員"},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        login(request, user)
        logger.info("登入成功：%s（%s）", user.username, "、".join(sorted(user.role_codes)))
        return Response(CurrentUserSerializer(user).data)


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(summary="登出", responses={204: None}, tags=["認證"])
    def post(self, request):
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        summary="取得目前使用者",
        description="回傳角色、功能權限、可見導航與可見專案。前端據此決定顯示什麼，"
                    "但真正的攔截一律在後端。",
        responses={200: CurrentUserSerializer},
        tags=["認證"],
    )
    def get(self, request):
        return Response(CurrentUserSerializer(request.user).data)


class ChangePasswordView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        summary="修改密碼",
        request=ChangePasswordSerializer,
        responses={200: CurrentUserSerializer, 400: OpenApiResponse(description="驗證失敗")},
        tags=["認證"],
    )
    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = request.user
        if not user.check_password(serializer.validated_data["old_password"]):
            return Response(
                {"type": "validation_error", "detail": "資料驗證失敗",
                 "errors": [{"field": "old_password", "code": "invalid", "message": "舊密碼不正確"}]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user.set_password(serializer.validated_data["new_password"])
        user.must_change_password = False
        user.save(update_fields=["password", "must_change_password"])
        # 改密碼後 session 不失效，使用者不用重登
        update_session_auth_hash(request, user)

        logger.info("使用者 %s 已修改密碼", user.username)
        return Response(CurrentUserSerializer(user).data)
