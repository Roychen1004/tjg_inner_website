from decimal import Decimal

from rest_framework import serializers

from main.apps.payables.models import Payable, PayableLog, Subcontract
from main.apps.payables.services import terms_service
from main.utils.choices import PayableState, PaymentMethod
from main.utils.permissions import has_permission


class SubcontractSerializer(serializers.ModelSerializer):
    """分包合約 —— 我們要付給包商的那一份合約。

    跟專案（業主付我們）是同一件事的鏡像，欄位刻意取一樣的名字。
    """

    project_name = serializers.CharField(source="project.name", read_only=True)
    project_code = serializers.CharField(source="project.code", read_only=True)
    vendor_name = serializers.CharField(source="vendor.name", read_only=True)
    category_label = serializers.CharField(source="get_category_display", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    payment_terms_display = serializers.SerializerMethodField()
    billed_amount = serializers.SerializerMethodField()
    paid_amount = serializers.SerializerMethodField()
    remaining_amount = serializers.SerializerMethodField()
    billed_pct = serializers.FloatField(read_only=True)
    payable_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Subcontract
        fields = [
            "id", "code", "project", "project_name", "project_code",
            "vendor", "vendor_name", "title", "category", "category_label",
            "contract_amount", "payment_term_type", "payment_term_days",
            "payment_terms_display", "retention_pct",
            "start_date", "end_date", "status", "status_label", "note",
            "billed_amount", "paid_amount", "remaining_amount", "billed_pct",
            "payable_count", "created_at",
        ]

    def get_payment_terms_display(self, obj) -> str:
        return terms_service.describe(obj.payment_term_type, obj.payment_term_days)

    def get_billed_amount(self, obj) -> str:
        return str(obj.billed_amount)

    def get_paid_amount(self, obj) -> str:
        return str(obj.paid_amount)

    def get_remaining_amount(self, obj) -> str:
        return str(obj.remaining_amount)


class SubcontractWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Subcontract
        fields = [
            "project", "vendor", "title", "category", "contract_amount",
            "payment_term_type", "payment_term_days", "retention_pct",
            "start_date", "end_date", "status", "note",
        ]

    def validate_contract_amount(self, value):
        if value is not None and value <= 0:
            raise serializers.ValidationError("合約金額必須大於 0")
        return value

    def validate(self, attrs):
        start = attrs.get("start_date") or getattr(self.instance, "start_date", None)
        end = attrs.get("end_date") or getattr(self.instance, "end_date", None)
        if start and end and end < start:
            raise serializers.ValidationError({"end_date": "預計完成日不能早於開始日"})

        # 已經計價過的合約，金額不能改到比已計價還低——
        # 那會讓「剩餘未計價」變成負數，現金流的預估級跟著錯
        amount = attrs.get("contract_amount")
        if self.instance and amount is not None:
            billed = self.instance.billed_amount
            if amount < billed:
                raise serializers.ValidationError({
                    "contract_amount": (
                        f"這張合約已計價 {billed:,.0f} 元，合約金額不能低於此數。"
                        "若確實要減帳，請先調整或刪除相關的應付款項"
                    )
                })
        return attrs


class PayableSerializer(serializers.ModelSerializer):
    """應付款項 —— 實際要付出去的一筆錢。

    跟應收款是鏡像：`next_states` 一樣由後端算，
    前端不重寫一次狀態機。
    """

    project_name = serializers.CharField(source="project.name", read_only=True)
    vendor_name = serializers.CharField(source="vendor.name", read_only=True)
    subcontract_title = serializers.CharField(source="subcontract.title", read_only=True, default="")
    subcontract_code = serializers.CharField(source="subcontract.code", read_only=True, default="")
    flow_unit_name = serializers.CharField(
        source="flow_unit.flow_item.name", read_only=True, default=""
    )
    category_label = serializers.CharField(source="get_category_display", read_only=True)
    state_label = serializers.CharField(source="get_state_display", read_only=True)
    method_label = serializers.CharField(source="get_payment_method_display", read_only=True)
    cash_date = serializers.DateField(read_only=True)
    is_overdue = serializers.BooleanField(read_only=True)
    next_states = serializers.SerializerMethodField()
    cash_date_note = serializers.SerializerMethodField()

    class Meta:
        model = Payable
        fields = [
            "id", "subcontract", "subcontract_code", "subcontract_title",
            "project", "project_name", "vendor", "vendor_name",
            "flow_unit", "flow_unit_name",
            "category", "category_label", "title",
            "amount", "tax_amount", "retention_amount", "payable_amount",
            "state", "state_label", "next_states",
            "billing_date", "due_date", "paid_date", "cash_date", "cash_date_note",
            "payment_method", "method_label", "check_due_date", "check_no",
            "invoice_no", "note", "is_overdue", "created_at",
        ]

    def get_next_states(self, obj) -> list[dict]:
        """這筆現在可以轉去哪。

        核可與登錄付款是**不同的權限**（職能分離，跟收款側同理）：
        同一個人不該既決定要付多少、又執行付款。
        """
        user = getattr(self.context.get("request"), "user", None)
        out = []
        labels = dict(PayableState.choices)
        if obj.state == PayableState.PENDING and has_permission(user, "approve_payable"):
            out.append(PayableState.APPROVED)
        elif obj.state == PayableState.APPROVED:
            if has_permission(user, "pay_payable"):
                out.append(PayableState.PAID)
            if has_permission(user, "approve_payable"):
                out.append(PayableState.PENDING)
        elif obj.state == PayableState.PAID and has_permission(user, "pay_payable"):
            out.append(PayableState.APPROVED)
        return [{"value": s, "label": labels[s]} for s in out]

    def get_cash_date_note(self, obj) -> str:
        """為什麼現金流用的是這一天。

        支票最容易被誤解：付款日到了、錢卻還沒出去。
        不寫這句，看的人會以為系統算錯。
        """
        if obj.payment_method != PaymentMethod.CHECK:
            return ""
        if obj.check_due_date:
            return f"支票 {obj.due_date or '（開票日未定）'} 開票、{obj.check_due_date} 兌現。現金流以兌現日計"
        return "⚠️ 付款方式是支票但沒填到期日，現金流暫以開票日計——實際出錢可能晚 60–90 天"


class PayableWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payable
        fields = [
            "subcontract", "project", "vendor", "flow_unit", "category", "title",
            "amount", "tax_amount", "retention_amount",
            "billing_date", "due_date", "payment_method", "check_due_date",
            "check_no", "invoice_no", "note",
        ]
        # 這三個在有綁分包合約時由合約決定（見 validate），沒綁時才要求填。
        # 宣告成必填會在 validate() 跑到之前就先擋下來
        extra_kwargs = {
            "project": {"required": False},
            "vendor": {"required": False},
            "category": {"required": False},
        }

    def validate_amount(self, value):
        if value is not None and value <= 0:
            raise serializers.ValidationError("金額必須大於 0")
        return value

    def validate(self, attrs):
        subcontract = attrs.get("subcontract") or getattr(self.instance, "subcontract", None)

        # 掛在合約底下時，專案與廠商一律跟合約走——
        # 讓使用者自己選只會選錯，而錯了專案成本就算到別的案子頭上
        if subcontract is not None:
            attrs["project"] = subcontract.project
            attrs["vendor"] = subcontract.vendor
            if not attrs.get("category"):
                attrs["category"] = subcontract.category
        else:
            for field, label in (
                ("project", "專案"), ("vendor", "廠商"), ("category", "類別"),
            ):
                if not attrs.get(field) and not getattr(
                    self.instance, f"{field}_id", getattr(self.instance, field, None)
                ):
                    raise serializers.ValidationError({field: f"沒有綁分包合約時，必須指定{label}"})

        # 掛的流程單元必須屬於同一個案子——掛錯案子，成本就算錯案子
        flow_unit = attrs.get("flow_unit") or getattr(self.instance, "flow_unit", None)
        project = attrs.get("project") or getattr(self.instance, "project", None)
        if flow_unit is not None and project is not None and flow_unit.project_id != project.pk:
            raise serializers.ValidationError({"flow_unit": "流程單元不屬於這個專案"})

        amount = attrs.get("amount", getattr(self.instance, "amount", None))

        # ⚠️ 「沒填」與「填 0」是兩件事。
        # 用 `if not value` 判斷會把明確填的 0 也當成沒填，然後覆蓋掉它——
        # 免稅的項目被硬加 5%、不扣保留款的項目被硬扣，而且沒有任何錯誤訊息。
        # 所以一律用 `in attrs` 判斷有沒有送這個欄位。
        if "retention_amount" not in attrs and subcontract and subcontract.retention_pct and amount:
            # 保留款是每期都會忘的事，忘一次就是這筆高估 5–10%
            attrs["retention_amount"] = (
                amount * subcontract.retention_pct / 100
            ).quantize(Decimal("1"))
        retention = attrs.get("retention_amount", getattr(self.instance, "retention_amount", None))
        if amount is not None and retention and retention > amount:
            raise serializers.ValidationError({"retention_amount": "保留款不能超過本次計價金額"})

        # D48：金額一律填稅後，稅額沒填就是 0（不再自動加 5%）
        if attrs.get("tax_amount") is None and amount is not None:
            attrs["tax_amount"] = Decimal("0")

        # 付款日沒填 → 由計價日與合約條件推算。推不出來就留空，不亂猜
        billing_date = attrs.get("billing_date", getattr(self.instance, "billing_date", None))
        if not attrs.get("due_date") and not getattr(self.instance, "due_date", None):
            if subcontract and billing_date:
                attrs["due_date"] = terms_service.due_date(
                    billing_date, subcontract.payment_term_type, subcontract.payment_term_days
                )

        method = attrs.get("payment_method", getattr(self.instance, "payment_method", None))
        check_due = attrs.get("check_due_date", getattr(self.instance, "check_due_date", None))
        due = attrs.get("due_date", getattr(self.instance, "due_date", None))
        if method == PaymentMethod.CHECK and check_due and due and check_due < due:
            raise serializers.ValidationError({"check_due_date": "支票到期日不會早於開票日"})
        return attrs


class PayableTransitionSerializer(serializers.Serializer):
    to_state = serializers.ChoiceField(choices=PayableState.choices)
    date = serializers.DateField(required=False, allow_null=True, help_text="實際付款日")
    payment_method = serializers.ChoiceField(
        choices=PaymentMethod.choices, required=False, allow_blank=True,
    )
    check_due_date = serializers.DateField(required=False, allow_null=True)
    check_no = serializers.CharField(required=False, allow_blank=True, max_length=30)
    reason = serializers.CharField(
        required=False, allow_blank=True, max_length=500, help_text="往回轉時必填",
    )


class PayableLogSerializer(serializers.ModelSerializer):
    changed_by_name = serializers.CharField(source="changed_by.name", read_only=True, default="系統")

    class Meta:
        model = PayableLog
        fields = ["id", "from_state", "to_state", "reason", "amount_snapshot",
                  "changed_by_name", "changed_at"]
