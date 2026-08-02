"""
Admin 操作按鈕

⚠️ 這是**暫時的**。前端做好之後，這些操作會在 React 畫面上完成，
現場人員永遠不會進 Django Admin。

保留它們的理由：在前端完成前，讓你能實際跑一次完整流程，
驗證業務邏輯正確。呼叫的是與未來 API 相同的 service 函式。
"""
from django import forms
from django.contrib import admin, messages
from django.shortcuts import redirect, render
from django.urls import path, reverse
from django.utils.html import format_html

from main.apps.inventory.models import Location
from main.apps.tracking.services import stage_service
from main.utils.choices import RollbackReason, StageDirection
from main.utils.exceptions import BusinessRuleError, ConcurrencyConflict


class SignoffForm(forms.Form):
    signoff_date = forms.DateField(
        label="簽收日", widget=forms.DateInput(attrs={"type": "date"}),
        help_text="業主／監造實際簽收的日期",
    )
    signoff_by_name = forms.CharField(label="簽收人", max_length=50, help_text="業主方人員姓名")
    signoff_doc_no = forms.CharField(label="簽收單號", max_length=40, required=False)
    signoff_location = forms.ModelChoiceField(
        label="簽收地點", queryset=Location.objects.filter(is_active=True),
        required=False, help_text="與合約指定地點比對，不符時會警告但不阻擋",
    )


class RollbackForm(forms.Form):
    reason_category = forms.ChoiceField(label="原因類別", choices=RollbackReason.choices)
    note = forms.CharField(label="說明", widget=forms.Textarea(attrs={"rows": 3}))


class TrackingUnitActionsMixin:
    """把推進／回退／簽收掛到 Admin 的物件頁面上"""

    change_form_template = "admin/tracking/trackingunit_change_form.html"

    def get_urls(self):
        urls = super().get_urls()
        custom = [
            path("<int:pk>/advance/", self.admin_site.admin_view(self.advance_view),
                 name="tracking_trackingunit_advance"),
            path("<int:pk>/rollback/", self.admin_site.admin_view(self.rollback_view),
                 name="tracking_trackingunit_rollback"),
            path("<int:pk>/signoff/", self.admin_site.admin_view(self.signoff_view),
                 name="tracking_trackingunit_signoff"),
        ]
        return custom + urls

    def _back(self, pk):
        return redirect(reverse("admin:tracking_trackingunit_change", args=[pk]))

    # ── 推進 ───────────────────────────────────────────────────────
    def advance_view(self, request, pk):
        try:
            result = stage_service.move_stage(pk, StageDirection.FORWARD, request.user)
        except (BusinessRuleError, ConcurrencyConflict) as exc:
            self.message_user(request, str(exc.detail), messages.ERROR)
            return self._back(pk)

        self.message_user(
            request,
            f"已推進至「{result.unit.current_stage.name}」",
            messages.SUCCESS,
        )
        for w in result.warnings:
            self.message_user(request, f"⚠ {w}", messages.WARNING)
        if result.next_action:
            self.message_user(request, f"➜ {result.next_action['message']}", messages.INFO)
        return self._back(pk)

    # ── 回退 ───────────────────────────────────────────────────────
    def rollback_view(self, request, pk):
        obj = self.get_object(request, pk)
        if request.method == "POST":
            form = RollbackForm(request.POST)
            if form.is_valid():
                try:
                    result = stage_service.move_stage(
                        pk, StageDirection.BACKWARD, request.user,
                        note=form.cleaned_data["note"],
                        reason_category=form.cleaned_data["reason_category"],
                    )
                except (BusinessRuleError, ConcurrencyConflict) as exc:
                    self.message_user(request, str(exc.detail), messages.ERROR)
                    return self._back(pk)

                self.message_user(
                    request, f"已回退至「{result.unit.current_stage.name}」", messages.SUCCESS,
                )
                if result.status_changed:
                    self.message_user(
                        request,
                        f"⚠ 狀態已變更為「{result.unit.get_status_display()}」"
                        f"（{result.status_changed['reason']}）",
                        messages.WARNING,
                    )
                return self._back(pk)
        else:
            form = RollbackForm()

        return render(request, "admin/tracking/action_form.html", {
            "title": f"回退階段：{obj.name}",
            "subtitle": f"目前在「{obj.current_stage.name}」，將退回「"
                        f"{obj.current_stage.previous_stage.name if obj.current_stage.previous_stage else '—'}」",
            "hint": "回退原因會成為 P3 品質失敗成本（PAF 模型）的統計來源，請據實填寫。",
            "form": form, "object": obj, "opts": self.model._meta,
            "action_url": request.path,
        })

    # ── 登錄簽收 ───────────────────────────────────────────────────
    def signoff_view(self, request, pk):
        obj = self.get_object(request, pk)
        if request.method == "POST":
            form = SignoffForm(request.POST)
            if form.is_valid():
                try:
                    unit, result, warnings = stage_service.record_signoff(
                        pk, request.user, **form.cleaned_data,
                    )
                except BusinessRuleError as exc:
                    self.message_user(request, str(exc.detail), messages.ERROR)
                    return self._back(pk)

                self.message_user(
                    request, f"已登錄簽收：{unit.signoff_by_name} / {unit.signoff_date}",
                    messages.SUCCESS,
                )
                if result.triggered:
                    self.message_user(
                        request,
                        f"💰 已產生請款事件：{result.milestone.label} "
                        f"{result.claim.amount:,.0f} 元　（{result.reason}）　已通知會計",
                        messages.SUCCESS,
                    )
                else:
                    self.message_user(
                        request,
                        f"尚未觸發請款：{result.reason}　進度：{result.progress_text}",
                        messages.INFO,
                    )
                for w in warnings:
                    self.message_user(request, f"⚠ {w}", messages.WARNING)
                return self._back(pk)
        else:
            form = SignoffForm(initial={"signoff_location": obj.project.site_locations.first()})

        milestone = None
        try:
            from main.apps.billing.services import trigger_service
            milestone = trigger_service.find_milestone_for(obj)
        except Exception:  # noqa: BLE001
            pass

        hint = "登錄簽收會依合約設定的觸發方式評估是否產生請款事件。"
        if milestone:
            hint += (
                f"\n對應里程碑：{milestone.label}（{milestone.get_trigger_type_display()}）"
                f"　金額 {milestone.amount:,.0f} 元"
            )

        return render(request, "admin/tracking/action_form.html", {
            "title": f"登錄進場簽收：{obj.name}",
            "subtitle": f"{obj.project.name}　目前在「{obj.current_stage.name}」",
            "hint": hint,
            "form": form, "object": obj, "opts": self.model._meta,
            "action_url": request.path,
        })

    # ── 列表上的操作欄 ─────────────────────────────────────────────
    @admin.display(description="操作")
    def actions_display(self, obj):
        buttons = []
        style = ("display:inline-block;padding:3px 10px;margin:1px;border-radius:4px;"
                 "font-size:11px;text-decoration:none;color:#fff;")

        if obj.can_rollback:
            buttons.append(format_html(
                '<a href="{}" style="{}background:#94a3b8">← 回退</a>',
                reverse("admin:tracking_trackingunit_rollback", args=[obj.pk]), style,
            ))
        if obj.is_awaiting_signoff:
            buttons.append(format_html(
                '<a href="{}" style="{}background:#d97706">✍ 登錄簽收</a>',
                reverse("admin:tracking_trackingunit_signoff", args=[obj.pk]), style,
            ))
        elif obj.can_advance:
            buttons.append(format_html(
                '<a href="{}" style="{}background:#2a78d6">下一步 →</a>',
                reverse("admin:tracking_trackingunit_advance", args=[obj.pk]), style,
            ))
        return format_html("".join(buttons)) if buttons else "—"
