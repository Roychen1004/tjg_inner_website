from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from main.apps.core.models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    category_label = serializers.CharField(source="get_category_display", read_only=True)

    class Meta:
        model = Notification
        fields = [
            "id", "title", "body", "link_url",
            "category", "category_label", "is_read", "created_at",
        ]


@extend_schema(responses=NotificationSerializer(many=True), description="站內通知")
class NotificationListView(APIView):
    """站內通知。

    只給自己的——`for_user` 是 QuerySet 層過濾，
    別人的通知不會因為改個 id 就看得到。
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = Notification.objects.for_user(request.user)
        unread = qs.unread().count()
        if request.query_params.get("unread") == "true":
            qs = qs.unread()
        limit = min(int(request.query_params.get("limit", 20)), 50)
        return Response({
            "unread_count": unread,
            "results": NotificationSerializer(qs[:limit], many=True).data,
        })


@extend_schema(responses=NotificationSerializer, description="標記已讀。不帶 id 就是全部")
class NotificationReadView(APIView):
    """標記已讀。不帶 id 就是全部標記已讀。"""

    permission_classes = [IsAuthenticated]

    def post(self, request, pk=None):
        qs = Notification.objects.for_user(request.user)
        if pk is not None:
            notification = qs.filter(pk=pk).first()
            if notification is None:
                return Response(
                    {"type": "not_found", "detail": "找不到這則通知"},
                    status=status.HTTP_404_NOT_FOUND,
                )
            notification.mark_read()
            return Response(NotificationSerializer(notification).data)

        count = qs.unread().update(is_read=True, read_at=timezone.now())
        return Response({"marked": count})
