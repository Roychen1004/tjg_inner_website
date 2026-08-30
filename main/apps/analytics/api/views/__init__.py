"""
儀表板

一個畫面回答一個問題：「今天有什麼要處理、公司現在整體狀況如何」。
刻意只做三個端點，不做「可自訂儀表板」——
能自訂的儀表板最後都變成沒人看的儀表板。
"""
from datetime import timedelta

from django.db.models import Count, Q, Sum
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from main.apps.billing.models import BillingMilestone
from main.apps.core.models import ActivityLog
from main.apps.projects.models import Project
from main.apps.tracking.models import FlowUnit, TrackingUnit
from main.apps.tracking.services.flow_service import gantt_rows
from main.utils.choices import FlowState, MilestoneState, Status
from main.utils.permissions import has_permission
from main.utils.scoping import (
    can_view_amount,
    scope_activities,
    scope_billing,
    scope_projects,
    scope_tracking_units,
)


@extend_schema(
    responses=OpenApiTypes.OBJECT,
    description="儀表板 KPI 卡片、階段分布、各案進度。回傳形狀見 web/src/api/types.ts 的 DashboardOverview",
)
class DashboardOverviewView(APIView):
    """GET /dashboard/overview —— KPI 卡片 ＋ 階段分布 ＋ 各案進度"""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        projects = scope_projects(Project.objects.all(), user).filter(is_closed=False)
        units = scope_tracking_units(
            TrackingUnit.objects.select_related("current_stage", "project"), user
        ).filter(project__is_closed=False)

        today = timezone.localdate()
        flow_units = FlowUnit.objects.filter(project__in=projects).exclude(
            state=FlowState.NA
        )
        flow_stats = flow_units.aggregate(
            open=Count("id", filter=Q(state__in=[FlowState.TODO, FlowState.DOING])),
            overdue=Count(
                "id",
                filter=Q(state__in=[FlowState.TODO, FlowState.DOING], plan_end__lt=today),
            ),
            unassigned=Count(
                "id", filter=Q(state=FlowState.DOING, assignee__isnull=True),
            ),
        )
        batch_delayed = units.filter(status=Status.DELAYED).count()

        cards = [
            {
                "key": "active_projects", "label": "進行中專案",
                "value": projects.count(), "unit": "案",
                "status": "neutral",
            },
            {
                "key": "open_flows", "label": "進行中流程",
                "value": flow_stats["open"], "unit": "項",
                "status": "neutral",
            },
            {
                "key": "attention", "label": "需要關注",
                "value": flow_stats["overdue"] + batch_delayed, "unit": "筆",
                "status": "bad" if flow_stats["overdue"] + batch_delayed else "good",
                "detail": f"逾期流程 {flow_stats['overdue']}、延誤批次 {batch_delayed}",
            },
        ]

        # 錢的卡片——看不到金額的角色就不給，而不是給一張空的
        if has_permission(user, "view_money"):
            milestones = scope_billing(BillingMilestone.objects.all(), user).filter(
                project__is_closed=False
            )
            agg = milestones.aggregate(
                total=Sum("amount"),
                received=Sum("amount", filter=Q(state=MilestoneState.RECEIVED)),
                claimable=Sum("amount", filter=Q(state=MilestoneState.CLAIMABLE)),
            )
            total = agg["total"] or 0
            received = agg["received"] or 0
            rate = round(float(received / total * 100), 1) if total else 0.0
            cards.append({
                "key": "collection_rate", "label": "收款率",
                "value": rate, "unit": "%",
                "status": "good" if rate >= 80 else ("warn" if rate >= 50 else "bad"),
                "detail": f"已收 {received:,.0f} / 應收 {total:,.0f} 元",
            })
            claimable = agg["claimable"] or 0
            if claimable:
                cards.append({
                    "key": "claimable", "label": "可請款",
                    "value": round(float(claimable) / 10000), "unit": "萬",
                    "status": "warn",
                    "detail": "條件到了、還沒開單的錢",
                })

        return Response({
            "cards": cards,
            "by_stage": self._stage_distribution(units),
            "projects": self._project_rows(projects, user),
            "can_view_amounts": has_permission(user, "view_money"),
        })

    def _stage_distribution(self, units):
        """階段分布：東西大多堆在哪一站。

        ⚠️ 必須依模板分組。鋼構的「加工」與土建的「施工中」都是第 2 站，
        混在一起數會得到一個沒有意義的數字——那不是同一件事。
        """
        rows = (
            units.values(
                "template__id", "template__name", "template__applies_to",
                "current_stage__name", "current_stage__seq", "current_stage__color",
            )
            .annotate(count=Count("id"))
            .order_by("template__id", "current_stage__seq")
        )
        grouped = {}
        for row in rows:
            key = row["template__id"]
            grouped.setdefault(key, {
                "template": row["template__name"],
                "applies_to": row["template__applies_to"],
                "total": 0,
                "stages": [],
            })
            grouped[key]["stages"].append({
                "name": row["current_stage__name"],
                "seq": row["current_stage__seq"],
                "color": row["current_stage__color"],
                "count": row["count"],
            })
            grouped[key]["total"] += row["count"]
        return sorted(grouped.values(), key=lambda g: -g["total"])

    def _project_rows(self, projects, user):
        """各案一行：目前大階段（由流程單元推導）、開放流程數、收款率。最多 10 筆。"""
        from django.utils import timezone

        today = timezone.localdate()
        rows = []
        qs = projects.select_related("customer").prefetch_related(
            "flow_units__stage"
        ).with_amounts()[:10]
        for project in qs:
            units = [
                u for u in project.flow_units.all() if u.state != FlowState.NA
            ]
            open_units = [
                u for u in units if u.state in (FlowState.TODO, FlowState.DOING)
            ]
            # 目前大階段＝最前面還有事沒做完的那一段；全做完就是最後一段
            open_stages = [s for s in (u.display_stage for u in open_units) if s]
            all_stages = [s for s in (u.display_stage for u in units) if s]
            if open_stages:
                current = min(open_stages, key=lambda s: s.seq)
            elif all_stages:
                current = max(all_stages, key=lambda s: s.seq)
            else:
                current = None
            overdue_units = sum(
                1
                for u in open_units
                if u.plan_end and u.plan_end < today
            )
            row = {
                "id": project.pk,
                "code": project.code,
                "name": project.name,
                "customer": project.customer.name if project.customer else "",
                "stage_name": current.name if current else "尚未勾選流程",
                "stage_seq": current.seq if current else 0,
                "stage_total": 5,
                "flow_gantt": gantt_rows(project),
                "unit_count": len(open_units),
                "attention": overdue_units,
                "status": project.status,
                "lifecycle": project.lifecycle,
                "due_date": project.due_date,
                "is_overdue": project.is_overdue,
            }
            if can_view_amount(user, project):
                row["contract_amount"] = str(project.effective_amount)
                row["received_amount"] = str(project.received_amount)
                row["collection_rate"] = project.collection_rate
            rows.append(row)
        return rows


@extend_schema(
    responses=OpenApiTypes.OBJECT,
    description="需要關注清單。回傳形狀見 web/src/api/types.ts 的 AttentionData",
)
class DashboardAttentionView(APIView):
    """GET /dashboard/attention —— 需要關注清單

    這是整個系統最有價值的一個端點：把「該有人去處理的事」集中成一張清單，
    而不是讓管理者自己去各個畫面翻。
    每一項都要能回答「為什麼在這裡」與「該做什麼」。
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        today = timezone.localdate()
        items = []
        units = scope_tracking_units(
            TrackingUnit.objects.select_related("project", "current_stage"), user
        ).filter(project__is_closed=False)

        # 0. 流程單元：逾期／進行中沒負責人／本週應完成
        flow_units = FlowUnit.objects.filter(
            project__in=scope_projects(Project.objects.active(), user)
        ).select_related("project", "flow_item", "assignee")
        soon7 = today + timedelta(days=7)
        for u in flow_units.filter(
            state__in=[FlowState.TODO, FlowState.DOING], plan_end__lt=today
        ).order_by("plan_end")[:20]:
            who = u.assignee.name if u.assignee else "（未指派）"
            items.append({
                "type": "flow_overdue",
                "severity": "bad",
                "title": f"{u.project.name}·{u.flow_display_name}",
                "reason": f"預計 {u.plan_end} 完成，已逾期 {(today - u.plan_end).days} 天。負責人：{who}",
                "action": "追進度",
                "link": f"/projects?open={u.project_id}",
                "unit_id": u.pk,
            })
        for u in flow_units.filter(state=FlowState.DOING, assignee__isnull=True)[:10]:
            items.append({
                "type": "flow_unassigned",
                "severity": "warn",
                "title": f"{u.project.name}·{u.flow_display_name}",
                "reason": "進行中但沒有負責人——沒人負責的事不會自己完成",
                "action": "指派負責人",
                "link": f"/projects?open={u.project_id}",
                "unit_id": u.pk,
            })
        for u in flow_units.filter(
            state__in=[FlowState.TODO, FlowState.DOING],
            plan_end__gte=today, plan_end__lte=soon7,
        ).order_by("plan_end")[:10]:
            who = u.assignee.name if u.assignee else "（未指派）"
            items.append({
                "type": "flow_due_soon",
                "severity": "info",
                "title": f"{u.project.name}·{u.flow_display_name}",
                "reason": f"預計 {u.plan_end} 完成。負責人：{who}",
                "action": "確認進度",
                "link": f"/projects?open={u.project_id}",
                "unit_id": u.pk,
            })

        # 1. 批次延誤與注意
        for unit in units.filter(status__in=[Status.ATRISK, Status.DELAYED])[:20]:
            items.append({
                "type": "unit_status",
                "severity": "bad" if unit.status == Status.DELAYED else "warn",
                "title": f"{unit.project.name}·{unit.name}",
                "reason": f"在「{unit.current_stage.name}」停留 {unit.days_in_stage} 天",
                "action": "查看進度",
                "link": f"/projects?open={unit.project_id}",
                "unit_id": unit.pk,
            })

        # 2. 停滯：超過該階段設定的天數
        for unit in units.exclude(status=Status.DELAYED)[:200]:
            if unit.is_stalled:
                items.append({
                    "type": "stalled",
                    "severity": "warn",
                    "title": f"{unit.project.name}·{unit.name}",
                    "reason": (
                        f"在「{unit.current_stage.name}」已 {unit.days_in_stage} 天"
                        f"（門檻 {unit.current_stage.stall_days} 天）"
                    ),
                    "action": "確認是否卡住",
                    "link": f"/projects?open={unit.project_id}",
                    "unit_id": unit.pk,
                })

        if has_permission(user, "view_money"):
            milestones = scope_billing(
                BillingMilestone.objects.select_related("project"), user
            ).filter(project__is_closed=False)

            # 3. 可請款放超過 7 天沒開單 —— 最容易漏掉的錢
            cutoff = timezone.now() - timedelta(days=7)
            for m in milestones.filter(
                state=MilestoneState.CLAIMABLE, claimable_at__lt=cutoff
            )[:20]:
                days = (timezone.now() - m.claimable_at).days
                items.append({
                    "type": "billing_overdue",
                    "severity": "bad",
                    "title": f"{m.project.name}·{m.label}",
                    "reason": f"可請款已 {days} 天未開單，金額 {m.amount:,.0f} 元",
                    "action": "開立請款單",
                    "link": f"/finance?milestone={m.pk}",
                })

            # 4. 預計請款日快到了還在「未到」——該確認能不能請了
            soon = today + timedelta(days=7)
            for m in milestones.filter(
                state=MilestoneState.PENDING,
                expected_date__isnull=False, expected_date__lte=soon,
            )[:20]:
                overdue = m.expected_date < today
                items.append({
                    "type": "milestone_due",
                    "severity": "warn" if overdue else "info",
                    "title": f"{m.project.name}·{m.label}",
                    "reason": (
                        f"預計 {m.expected_date} 請款"
                        + ("，已過期" if overdue else "，快到了")
                        + "。條件到了就轉「可請款」"
                    ),
                    "action": "確認請款條件",
                    "link": f"/finance?milestone={m.pk}",
                })

            # 5. 應付款 7 天內要付
            from main.apps.payables.models import Payable
            from main.utils.choices import PayableState
            from main.utils.scoping import scope_payables

            payables = scope_payables(
                Payable.objects.select_related("vendor", "project"), user
            ).filter(state=PayableState.APPROVED).due_between(today, soon)
            for payable in payables[:20]:
                items.append({
                    "type": "payable_due",
                    "severity": "warn",
                    "title": f"{payable.vendor.name}·{payable.title}",
                    "reason": f"{payable.cash_date} 要付 {payable.payable_amount:,.0f} 元",
                    "action": "安排付款",
                    "link": f"/finance?payable={payable.pk}",
                })

        # 6. 專案逾期
        for project in scope_projects(Project.objects.all(), user).filter(
            is_closed=False, due_date__lt=today
        )[:10]:
            items.append({
                "type": "project_overdue",
                "severity": "bad",
                "title": project.name,
                "reason": f"預計完工 {project.due_date}，已逾期 {(today - project.due_date).days} 天",
                "action": "檢視專案",
                # ?open= 會讓專案頁直接展開這一案。專案是「展開」不是「換頁」
                "link": f"/projects?open={project.pk}",
            })

        order = {"bad": 0, "warn": 1, "info": 2}
        items.sort(key=lambda i: order.get(i["severity"], 3))
        return Response({
            "count": len(items),
            "by_severity": {
                "bad": sum(1 for i in items if i["severity"] == "bad"),
                "warn": sum(1 for i in items if i["severity"] == "warn"),
                "info": sum(1 for i in items if i["severity"] == "info"),
            },
            "results": items[:60],
        })


@extend_schema(responses=OpenApiTypes.OBJECT, description="最近動態")
class ActivityFeedView(APIView):
    """GET /dashboard/activities —— 最近動態，依可見範圍過濾。"""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = scope_activities(
            ActivityLog.objects.select_related("actor", "project"), request.user
        )
        if category := request.query_params.get("category"):
            qs = qs.filter(category=category)
        if project := request.query_params.get("project"):
            qs = qs.filter(project_id=project)

        limit = min(int(request.query_params.get("limit", 20)), 50)
        return Response([
            {
                "id": a.pk,
                "verb": a.verb,
                "category": a.category,
                "actor": a.actor.name if a.actor else "系統",
                "project": a.project.name if a.project else "",
                "created_at": a.created_at,
            }
            for a in qs[:limit]
        ])
