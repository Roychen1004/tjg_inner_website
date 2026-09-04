import datetime as dt

from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response

from main.apps.affairs.models import AffairCategory, AffairRule, AffairTask
from main.apps.affairs.serializers import (
    AffairCategorySerializer,
    AffairRuleSerializer,
    AffairRuleWriteSerializer,
    AffairTaskSerializer,
    AffairTaskWriteSerializer,
)
from main.apps.affairs.services import notify_service, schedule_service
from main.utils.exceptions import BusinessRuleError
from main.utils.permissions import has_permission
from main.utils.viewsets import BaseModelViewSet, bool_param


def _denied(message):
    return Response(
        {"type": "permission_denied", "detail": message},
        status=status.HTTP_403_FORBIDDEN,
    )


class AffairCategoryViewSet(BaseModelViewSet):
    """行政類別。讀給全體（篩選與表單下拉），寫給經理與系統管理員。"""

    queryset = AffairCategory.objects.all()
    serializer_class = AffairCategorySerializer
    pagination_class = None   # 小主檔，整包給
    read_permission = None
    write_permission = "edit_affairs"

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.query_params.get("active") != "false":
            qs = qs.filter(is_active=True)
        return qs.order_by("id")

    def perform_destroy(self, instance):
        if instance.tasks.exists() or instance.rules.exists():
            raise BusinessRuleError("這個類別已有行政事項使用，不能刪除；可改為停用")
        instance.delete()


class AffairRuleViewSet(BaseModelViewSet):
    """例行規則。建立／修改後立即展開成逐次待辦（schedule_service）。"""

    queryset = AffairRule.objects.all()
    serializer_class = AffairRuleSerializer
    write_serializer_class = AffairRuleWriteSerializer
    pagination_class = None
    read_permission = None
    write_permission = "edit_affairs"

    def get_queryset(self):
        qs = super().get_queryset()
        if self.action == "list":
            qs = qs.select_related("category").prefetch_related("assignees")
        if self.request.query_params.get("active") != "false":
            qs = qs.filter(is_active=True)
        return qs.order_by("id")

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)
        rule = serializer.instance
        schedule_service.materialize_rule(rule)
        notify_service.rule_assigned(rule, self.request.user, list(rule.assignees.all()))

    def update(self, request, *args, **kwargs):
        rule = self.get_object()
        before = set(rule.assignees.values_list("id", flat=True))
        response = super().update(request, *args, **kwargs)
        if response.status_code == 200:
            rule.refresh_from_db()
            # 今天起未完成的重長（標題、類別、指派、頻率都以新規則為準）
            schedule_service.resync(rule)
            added = rule.assignees.exclude(pk__in=before)
            notify_service.rule_assigned(rule, request.user, list(added))
        return response

    def perform_destroy(self, instance):
        # 未來還沒做的一起收走；做過的與過去的留著（rule 變 NULL），歷史不斷
        instance.tasks.filter(
            is_done=False, date__gte=timezone.localdate()
        ).delete()
        instance.delete()


class AffairTaskViewSet(BaseModelViewSet):
    """行政待辦（日曆上的一格）。

    權限兩層：
      · 新增／修改／刪除　＝ edit_affairs（經理與系統管理員）
      · 勾完成　　　　　　＝ 被指派的員工本人也可以（多人任一人勾即完成）
    """

    queryset = AffairTask.objects.all()
    serializer_class = AffairTaskSerializer
    write_serializer_class = AffairTaskWriteSerializer
    pagination_class = None
    read_permission = None
    write_permission = None   # 逐方法檢查（員工要能勾自己的完成）

    def get_queryset(self):
        qs = super().get_queryset()
        # 只有列表型的 action 需要 eager load；單筆操作（勾完成、修改）
        # 被權限擋下時這些關聯根本用不到，nplusone 會抓
        if self.action in ("list", "mine"):
            qs = qs.select_related("category", "rule", "done_by").prefetch_related("assignees")
        params = self.request.query_params
        if category := params.get("category"):
            qs = qs.filter(category_id=category)
        if bool_param(self.request, "undone"):
            qs = qs.filter(is_done=False)
        return qs.order_by("date", "id")

    def _can_edit(self):
        return has_permission(self.request.user, "edit_affairs")

    def list(self, request, *args, **kwargs):
        """?start=&end=（YYYY-MM-DD，必帶）——日曆一次看一段，最多 400 天"""
        try:
            start = dt.date.fromisoformat(request.query_params.get("start") or "")
            end = dt.date.fromisoformat(request.query_params.get("end") or "")
        except ValueError:
            return Response(
                {"type": "validation_error", "detail": "請帶 start 與 end（YYYY-MM-DD）"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if end < start or (end - start).days > 400:
            return Response(
                {"type": "validation_error", "detail": "日期範圍最多 400 天"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # 順手把例行規則該長的長出來——沒有排程器，靠瀏覽觸發
        schedule_service.ensure_until(end)
        qs = self.get_queryset().filter(date__range=(start, end))
        return Response(self.get_serializer(qs, many=True).data)

    def create(self, request, *args, **kwargs):
        if not self._can_edit():
            return _denied("只有經理或系統管理員能新增行政事項")
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(created_by=request.user)
        task = serializer.instance
        notify_service.task_assigned(task, request.user, list(task.assignees.all()))
        return self._read_response(task, status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        if not self._can_edit():
            return _denied("只有經理或系統管理員能修改行政事項")
        task = self.get_object()
        before = set(task.assignees.values_list("id", flat=True))
        response = super().update(request, *args, **kwargs)
        if response.status_code == 200:
            task.refresh_from_db()
            added = task.assignees.exclude(pk__in=before)
            notify_service.task_assigned(task, request.user, list(added))
        return response

    def destroy(self, request, *args, **kwargs):
        if not self._can_edit():
            return _denied("只有經理或系統管理員能刪除行政事項")
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        """勾完成／取消完成。body：{done: true|false}，不帶＝完成。

        完成不需要主管再確認（跟案子任務同一條規矩），
        但會通知經理與系統管理員（誰、何時、完成了什麼）。
        """
        task = self.get_object()
        user = request.user
        if not self._can_edit() and not task.assignees.filter(pk=user.pk).exists():
            return _denied("只有被指派的人、經理或系統管理員能勾完成")
        done = str(request.data.get("done", True)).lower() not in ("false", "0", "")
        if done and not task.is_done:
            task.is_done, task.done_by, task.done_at = True, user, timezone.now()
            task.save(update_fields=["is_done", "done_by", "done_at", "updated_at"])
            notify_service.task_completed(task, user)
        elif not done and task.is_done:
            task.is_done, task.done_by, task.done_at = False, None, None
            task.save(update_fields=["is_done", "done_by", "done_at", "updated_at"])
        return Response(self.get_serializer(task).data)

    @action(detail=False, methods=["get"])
    def mine(self, request):
        """「我的任務」的行政區塊：指派給我、未完成、日期在 14 天內（含逾期）"""
        schedule_service.ensure_until()
        today = timezone.localdate()
        qs = self.get_queryset().filter(
            assignees=request.user, is_done=False,
            date__lte=today + dt.timedelta(days=14),
        )
        return Response(self.get_serializer(qs, many=True).data)
