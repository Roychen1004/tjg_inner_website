"""
附件 API

核心原則只有一句：

    **附件的可見範圍＝它掛的那個東西的可見範圍。**

不另外設一套附件權限。看得到那個專案／批次／請款事件的人就看得到它的附件，
看不到的人連檔案存在都不知道（回 404 而非 403，決策 T06）。

下載走 X-Accel-Redirect：Django 只檢查權限、回一個 header，
檔案本體由 nginx 送——25MB 的圖說不會經過 Python 的記憶體（決策 T11）。
"""
import mimetypes
import os
from urllib.parse import quote

from django.conf import settings
from django.contrib.contenttypes.models import ContentType
from django.http import FileResponse, Http404, HttpResponse
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers, status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from main.apps.core.models import Attachment, Role
from main.apps.core.services import attachment_service
from main.utils.choices import AttachmentCategory
from main.utils.exceptions import BusinessRuleError
from main.utils.permissions import has_permission

# ── 附件可以掛在哪三個地方（決策 D32）─────────────────────────────
#
# 刻意用 "project" 這種名字而不是 ContentType 的 id：
# ContentType id 是資料庫的內部編號，換一台機器就不一樣，
# 沒有理由讓前端知道它。
#
# 每一種都要說明：怎麼取得母物件、誰看得到、誰能上傳。
TARGETS = {
    "project": {
        "label": "專案",
        "model": ("projects", "project"),
        "scope": "main.utils.scoping.scope_projects",
        "write_permission": "edit_project",
    },
    "tracking-unit": {
        "label": "構件批次",
        "model": ("tracking", "trackingunit"),
        "scope": "main.utils.scoping.scope_tracking_units",
        "write_permission": "edit_tracking",
    },
    "flow-unit": {
        "label": "流程單元",
        "model": ("tracking", "flowunit"),
        "scope": "main.utils.scoping.scope_tracking_units",
        "write_permission": "edit_tracking",
    },
    "milestone": {
        "label": "應收款",
        "model": ("billing", "billingmilestone"),
        "scope": "main.utils.scoping.scope_billing",
        "write_permission": "edit_milestone",
    },
    # 行政事項（D53）：全員都看得到，寫給經理；被指派的人也能傳
    # （完成回報要附照片、繳費要附收據）
    "affair-task": {
        "label": "行政事項",
        "model": ("affairs", "affairtask"),
        "scope": "main.utils.scoping.scope_affairs",
        "write_permission": "edit_affairs",
    },
}


#: 這幾類附件的**內容本身就是金額**。
#:
#: 「檢視」角色看得到專案，但看不到合約金額（scoping.can_view_amount）。
#: 若他下載得到合約 PDF，那道限制等於沒有——第一頁就寫著合約總價。
#: 欄位擋了、檔案沒擋，是最容易漏掉的一種洩漏。
AMOUNT_BEARING = frozenset({AttachmentCategory.CONTRACT, AttachmentCategory.INVOICE})


def can_see_category(user, category, project):
    if category not in AMOUNT_BEARING:
        return True
    from main.utils.scoping import can_view_amount

    return can_view_amount(user, project)




def _import(path):
    module, name = path.rsplit(".", 1)
    return getattr(__import__(module, fromlist=[name]), name)


def resolve_target(target: str, object_id, user):
    """取得母物件，並套用它自己的可見範圍。

    取不到就 404——不區分「沒這筆」與「有但你看不到」，
    否則錯誤碼本身就洩漏了資料存在的事實。
    """
    spec = TARGETS.get(target)
    if spec is None:
        raise BusinessRuleError(
            f"不支援的掛載對象「{target}」。可用：{'、'.join(TARGETS)}"
        )
    app_label, model_name = spec["model"]
    content_type = ContentType.objects.get_by_natural_key(app_label, model_name)
    model = content_type.model_class()

    scoped = _import(spec["scope"])(model.objects.all(), user)
    obj = scoped.filter(pk=object_id).first()
    if obj is None:
        raise Http404
    return obj, content_type, spec


class AttachmentSerializer(serializers.ModelSerializer):
    category_label = serializers.CharField(source="get_category_display", read_only=True)
    uploaded_by_name = serializers.CharField(source="uploaded_by.name", read_only=True, default="")
    size_display = serializers.CharField(read_only=True)
    ext = serializers.CharField(read_only=True)
    can_delete = serializers.SerializerMethodField()
    no_preview_reason = serializers.SerializerMethodField()

    class Meta:
        model = Attachment
        fields = [
            "id", "original_name", "size_bytes", "size_display", "mime_type", "ext",
            "category", "category_label", "is_previewable", "no_preview_reason",
            "checksum", "note", "uploaded_by_name", "uploaded_at", "can_delete",
        ]

    def get_can_delete(self, obj) -> bool:
        """刪除限**上傳者本人或經理**。

        合約與簽收單是爭議時的依據。讓任何有編輯權的人都能刪掉別人上傳的合約，
        等於把公司的證據交給運氣。
        """
        user = getattr(self.context.get("request"), "user", None)
        if user is None or not user.is_authenticated:
            return False
        return (
            obj.uploaded_by_id == user.pk
            or user.is_superuser
            or user.has_role(Role.OWNER)
        )

    def get_no_preview_reason(self, obj) -> str:
        """不能預覽時直接說為什麼，不做「假的預覽按鈕」——

        按了才跳出「無法預覽」，比一開始就講清楚更糟。
        """
        if obj.is_previewable:
            return ""
        return {
            "dwg": "CAD 圖檔無法在瀏覽器預覽，請下載後用 AutoCAD 開啟",
            "xlsx": "Excel 檔無法在瀏覽器預覽，請下載後開啟",
        }.get(obj.ext, "這種格式無法在瀏覽器預覽，請下載後開啟")


class AttachmentListView(APIView):
    """列出某個物件的附件、上傳新附件。"""

    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    @extend_schema(
        parameters=[
            OpenApiParameter("target", str, description="project｜tracking-unit｜milestone", required=True),
            OpenApiParameter("id", int, description="母物件 id", required=True),
        ],
        responses=AttachmentSerializer(many=True),
    )
    def get(self, request):
        target = request.query_params.get("target", "")
        object_id = request.query_params.get("id")
        if not object_id:
            raise BusinessRuleError("必須指定 target 與 id")

        obj, content_type, _spec = resolve_target(target, object_id, request.user)
        rows = Attachment.objects.filter(
            content_type=content_type, object_id=obj.pk
        ).select_related("uploaded_by")

        project = _project_of(obj)
        if not can_see_category(request.user, AttachmentCategory.CONTRACT, project):
            # 過濾掉而不是顯示「有一個檔案但你不能看」——
            # 後者一樣洩漏了「這個案子有合約、金額大概多大」的訊息
            rows = rows.exclude(category__in=AMOUNT_BEARING)

        return Response({
            "results": AttachmentSerializer(rows, many=True, context={"request": request}).data,
            "can_upload": self._can_upload(request.user, target, obj),
            "categories": [
                {"value": v, "label": label} for v, label in AttachmentCategory.choices
            ],
            "max_size_mb": settings.MAX_UPLOAD_SIZE_MB,
            "allowed_extensions": settings.ALLOWED_UPLOAD_EXTENSIONS,
        })

    @extend_schema(request=OpenApiTypes.OBJECT, responses=AttachmentSerializer)
    def post(self, request):
        target = request.data.get("target", "")
        object_id = request.data.get("id")
        upload = request.FILES.get("file")
        if not object_id or upload is None:
            raise BusinessRuleError("必須指定 target、id 與 file")

        obj, content_type, spec = resolve_target(target, object_id, request.user)
        if not self._can_upload(request.user, target, obj):
            return Response(
                {"type": "permission_denied", "detail": f"你沒有上傳{spec['label']}附件的權限"},
                status=status.HTTP_403_FORBIDDEN,
            )

        processed, meta = attachment_service.process_upload(upload)

        category = request.data.get("category") or AttachmentCategory.OTHER
        if category not in AttachmentCategory.values:
            category = AttachmentCategory.OTHER

        attachment = Attachment.objects.create(
            content_type=content_type,
            object_id=obj.pk,
            file=processed,
            original_name=upload.name[:255],
            category=category,
            note=(request.data.get("note") or "")[:200],
            uploaded_by=request.user,
            **meta,
        )

        from main.apps.core.models import ActivityLog
        from main.utils.choices import ActivityCategory

        ActivityLog.record(
            f"{obj} 上傳附件「{attachment.original_name}」",
            ActivityCategory.SYSTEM, actor=request.user,
            project=_project_of(obj), obj=attachment,
        )
        return Response(
            AttachmentSerializer(attachment, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )

    @staticmethod
    def _can_upload(user, target, obj=None):
        spec = TARGETS.get(target)
        if not spec:
            return False
        if has_permission(user, spec["write_permission"]):
            return True
        # 員工能給**自己被指派的**流程單元傳產出物——上傳權跟著任務走
        if target == "flow-unit" and obj is not None:
            return getattr(obj, "assignee_id", None) == user.pk
        # 行政事項（D53）同理：被指派的人要能附完成照片與收據
        if target == "affair-task" and obj is not None:
            return obj.assignees.filter(pk=user.pk).exists()
        return False


def _project_of(obj):
    """動態記錄要掛在哪個專案底下。專案本身就是自己。"""
    from main.apps.projects.models import Project

    if isinstance(obj, Project):
        return obj
    return getattr(obj, "project", None) or getattr(
        getattr(obj, "milestone", None), "project", None
    )


class AttachmentDetailView(APIView):
    """下載、預覽、刪除。"""

    permission_classes = [IsAuthenticated]

    def _get_attachment(self, request, pk):
        """先取附件，再回頭檢查它掛的那個物件看不看得到。

        ⚠️ 順序很重要：不能只檢查附件本身存不存在就放行——
        附件沒有自己的權限，它借用母物件的。
        """
        attachment = Attachment.objects.filter(pk=pk).select_related("content_type").first()
        if attachment is None:
            raise Http404

        target = next(
            (
                name
                for name, spec in TARGETS.items()
                if spec["model"] == (attachment.content_type.app_label, attachment.content_type.model)
            ),
            None,
        )
        if target is None:
            raise Http404
        obj, _ct, _spec = resolve_target(target, attachment.object_id, request.user)
        if not can_see_category(request.user, attachment.category, _project_of(obj)):
            raise Http404
        return attachment

    @extend_schema(responses=OpenApiTypes.BINARY)
    def get(self, request, pk):
        attachment = self._get_attachment(request, pk)
        inline = request.query_params.get("inline") == "1" and attachment.is_previewable
        return _serve(attachment, inline=inline)

    @extend_schema(responses={204: None})
    def delete(self, request, pk):
        attachment = self._get_attachment(request, pk)
        user = request.user
        is_owner_role = user.is_superuser or user.has_role(Role.OWNER)
        if attachment.uploaded_by_id != user.pk and not is_owner_role:
            return Response(
                {
                    "type": "permission_denied",
                    "detail": "只有上傳者本人或經理能刪除附件。"
                              "合約與簽收單是爭議時的依據，不讓任何有編輯權的人都刪得掉",
                },
                status=status.HTTP_403_FORBIDDEN,
            )
        attachment.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


def _serve(attachment, inline=False):
    """交給 nginx 送，Django 不碰檔案內容。

    正式環境用 X-Accel-Redirect：回一個空 body ＋ 一個 header，
    nginx 讀 `/protected-media/` 這個 internal location 把檔案送出去。
    開發環境（`runserver`／沒有 nginx）沒有這個機制，直接用 FileResponse。
    """
    disposition = "inline" if inline else "attachment"
    # 中文檔名要用 RFC 5987 的 filename*，否則某些瀏覽器會存成亂碼
    quoted = quote(attachment.original_name)
    content_type = attachment.mime_type or mimetypes.guess_type(attachment.original_name)[0] \
        or "application/octet-stream"

    if getattr(settings, "USE_X_ACCEL_REDIRECT", True):
        response = HttpResponse(content_type=content_type)
        response["X-Accel-Redirect"] = f"/protected-media/{attachment.file.name}"
        response["Content-Length"] = attachment.size_bytes
    else:
        try:
            response = FileResponse(attachment.file.open("rb"), content_type=content_type)
        except FileNotFoundError:
            raise Http404 from None

    response["Content-Disposition"] = f"{disposition}; filename*=UTF-8''{quoted}"
    # ⚠️ 這兩個 header 不是裝飾。副檔名可以被偽造，瀏覽器又會自己「猜」類型——
    # nosniff 就是叫它不要猜
    response["X-Content-Type-Options"] = "nosniff"
    response["Content-Security-Policy"] = "default-src 'none'; sandbox"
    return response


def media_root_ok():
    """給 setup 檢查用：MEDIA_ROOT 存在且可寫嗎"""
    return os.path.isdir(settings.MEDIA_ROOT) and os.access(settings.MEDIA_ROOT, os.W_OK)
