from rest_framework.response import Response

from main.apps.production.models import ProductionLine
from main.apps.production.serializers import (
    ProductionLineSerializer,
    ProductionLineWriteSerializer,
)
from main.utils.choices import LineStatus
from main.utils.viewsets import BaseModelViewSet


class ProductionLineViewSet(BaseModelViewSet):
    """產線狀態。

    P1 由廠長人工更新，回答「機台現在在忙什麼」。
    P3 導入報工後改由系統計算 OEE，這個寫入端點就會退場（誠實標註，避免以為已經自動化）。
    """

    queryset = ProductionLine.objects.filter(is_active=True).select_related("updated_by")
    serializer_class = ProductionLineSerializer
    write_serializer_class = ProductionLineWriteSerializer
    read_permission = "view_lines"
    write_permission = "edit_lines"
    pagination_class = None
    http_method_names = ["get", "patch", "head", "options"]

    def list(self, request, *args, **kwargs):
        lines = self.get_queryset()
        data = ProductionLineSerializer(lines, many=True).data
        running = sum(1 for line in lines if line.status == LineStatus.RUN)
        utils = [float(line.utilization) for line in lines if line.utilization is not None]
        return Response({
            "results": data,
            "summary": {
                "total": len(data),
                "running": running,
                "avg_utilization": round(sum(utils) / len(utils), 1) if utils else None,
            },
            "data_source": "人工更新（P3 導入報工後改為自動計算）",
        })
