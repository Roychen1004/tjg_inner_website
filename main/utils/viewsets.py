"""
ViewSet 共用基底

把三件每個 ViewSet 都要做的事收在一起：
  1. 資料可見範圍（get_queryset 過濾，不是前端隱藏）
  2. 讀寫用不同序列化器
  3. 統一的分頁與篩選慣例
"""
from rest_framework import status, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from main.utils.pagination import StandardPagination
from main.utils.permissions import ReadWritePermission


class BaseModelViewSet(viewsets.ModelViewSet):
    """全系統 ViewSet 的基底。

    子類別設定：
        read_permission  / write_permission  → 功能權限
        scope_function                        → 資料可見範圍
        write_serializer_class                → 建立與修改用的序列化器
    """

    permission_classes = [IsAuthenticated, ReadWritePermission]
    pagination_class = StandardPagination

    scope_function = None
    write_serializer_class = None
    detail_serializer_class = None

    def get_queryset(self):
        qs = super().get_queryset()
        if self.scope_function is not None:
            # 子類別用 staticmethod() 包起來，這裡取到的是純函式
            qs = self.scope_function(qs, self.request.user)
        return qs

    def get_serializer_class(self):
        if self.action in ("create", "update", "partial_update") and self.write_serializer_class:
            return self.write_serializer_class
        if self.action == "retrieve" and self.detail_serializer_class:
            return self.detail_serializer_class
        return super().get_serializer_class()

    # ── 建立／修改後回傳「讀取」的形狀 ────────────────────────────
    # DRF 預設回傳寫入序列化器的欄位，裡面沒有 id、沒有系統產生的編號、
    # 沒有起始階段——前端存完之後拿不到剛建的東西長什麼樣，
    # 只能再打一次 GET。這裡直接回完整形狀。
    def _read_response(self, instance, code=status.HTTP_200_OK):
        serializer_class = self.detail_serializer_class or self.serializer_class
        instance = self.get_queryset().filter(pk=instance.pk).first() or instance
        return Response(
            serializer_class(instance, context=self.get_serializer_context()).data,
            status=code,
        )

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return self._read_response(serializer.instance, status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(
            instance, data=request.data, partial=kwargs.pop("partial", False)
        )
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        return self._read_response(serializer.instance)


class ReadOnlyViewSet(viewsets.ReadOnlyModelViewSet):
    """主檔類的唯讀端點。主檔維護走 Django Admin（決策 T03）。"""

    permission_classes = [IsAuthenticated]
    pagination_class = StandardPagination


def bool_param(request, name):
    """?flag=true / 1 / yes → True；沒帶 → None（表示不篩選）"""
    raw = request.query_params.get(name)
    if raw is None or raw == "":
        return None
    return raw.lower() in ("1", "true", "yes", "on")
