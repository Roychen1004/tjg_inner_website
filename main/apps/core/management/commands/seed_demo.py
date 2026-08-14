"""
示範資料：固越企業總部案（完整鋼構案）＋ 彰化、南投兩案

三案的應收款刻意鋪在四種狀態上（已收款、已請款、可請款、未到），
現金流的三個確定性等級一開機就看得到。

⚠️ 僅供開發與教育訓練使用，正式上線前請清除。
"""
from datetime import date, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from main.apps.billing.models import BillingMilestone, MilestoneLog
from main.apps.core.models import User
from main.apps.masters.models import Customer, StageTemplate, Vendor
from main.apps.payables.services import terms_service
from main.apps.projects.models import Project
from main.apps.tracking.models import TrackingUnit
from main.utils.choices import (
    MilestoneState,
    PaymentTermType,
    ProjectType,
    Status,
    SubcontractCategory,
    TemplateAppliesTo,
    UnitType,
    VendorType,
)


class Command(BaseCommand):
    help = "載入示範資料（固越／彰化／南投三案）。僅供開發與教育訓練"

    def add_arguments(self, parser):
        parser.add_argument("--clear", action="store_true", help="先清除既有示範資料")

    @transaction.atomic
    def handle(self, *args, **options):
        if options["clear"]:
            self._clear()

        if not StageTemplate.objects.exists():
            self.stderr.write(self.style.ERROR("請先執行：python manage.py seed_masters"))
            return
        if not User.objects.filter(username="owner").exists():
            self.stderr.write(self.style.ERROR("請先執行：python manage.py seed_accounts"))
            return

        self.stdout.write(self.style.MIGRATE_HEADING("載入示範資料"))
        self._seed_customers_vendors()
        self._seed_projects()
        self._seed_payables()
        self.stdout.write(self.style.SUCCESS("\n✔ 示範資料載入完成"))
        self._print_guide()

    # ── 清除 ───────────────────────────────────────────────────────
    def _clear(self):
        """刪除順序由 PROTECT 外鍵決定：應付 → 分包合約 → 專案（連帶應收與單元）"""
        from main.apps.payables.models import Payable, PayableLog, Subcontract

        self.stdout.write("清除既有示範資料…")
        PayableLog.objects.all().delete()
        Payable.objects.all().delete()
        Subcontract.objects.all().delete()
        Project.objects.all().delete()  # cascade：應收款、追蹤單元、歷程、變更單
        self.stdout.write("  完成\n")

    # ── 主檔 ───────────────────────────────────────────────────────
    def _seed_customers_vendors(self):
        self.stdout.write("\n▸ 客戶與廠商")
        for code, name, tax, term, days in [
            ("C001", "固越企業", "12345678", PaymentTermType.MONTH_END, 60),
            ("C002", "統一食品", "23456789", PaymentTermType.MONTH_END, 30),
            # 公家機關通常是驗收後起算
            ("C003", "國工局", "", PaymentTermType.FROM_ACCEPTANCE, 45),
        ]:
            Customer.objects.update_or_create(
                code=code,
                defaults={
                    "name": name, "tax_id": tax,
                    # 帳期是現金流收入側的來源。三家刻意不同，才看得出差別
                    "payment_term_type": term, "payment_term_days": days,
                },
            )

        for code, name, types in [
            ("V001", "中鋼鋼鐵", [VendorType.SUPPLIER]),
            ("V002", "全興噴砂廠", [VendorType.OUTSOURCE, VendorType.SUPPLIER]),
            ("V003", "大發板車運輸", [VendorType.TRANSPORT]),
            ("V005", "永固土木包商", [VendorType.SUBCONTRACTOR]),
        ]:
            Vendor.objects.update_or_create(
                code=code, defaults={"name": name, "vendor_types": types},
            )
        self.stdout.write("    3 個客戶、4 家廠商")

    # ── 專案 ───────────────────────────────────────────────────────
    def _seed_projects(self):
        self.stdout.write("\n▸ 專案")
        today = timezone.localdate()
        owner = User.objects.get(username="owner")
        finance = User.objects.get(username="finance")
        main_tpl = StageTemplate.default_for(TemplateAppliesTo.PROJECT_MAIN)
        steel_tpl = StageTemplate.default_for(TemplateAppliesTo.STEEL_BATCH)
        civil_tpl = StageTemplate.default_for(TemplateAppliesTo.CIVIL_WORK_ITEM)

        # ── 固越企業總部案：走到一半的完整案 ──
        guyue, _ = Project.objects.update_or_create(
            name="固越企業總部新建工程",
            defaults={
                "project_type": ProjectType.MIXED,
                "customer": Customer.objects.get(code="C001"),
                "contract_amount": Decimal("80000000"),
                "owner": owner,
                "start_date": date(2026, 1, 10), "due_date": date(2026, 11, 30),
                "main_template": main_tpl,
                "main_stage": main_tpl.stages.get(code="build"),
                "status": Status.ONTRACK,
                "contract_terms": "工期 300 日曆天；付款：簽約 15%、進料 25%、出貨安裝 40%、驗收 20%",
            },
        )

        # 應收款四列，四種狀態各一——demo 一眼看懂生命週期
        milestone_specs = [
            (1, "第一期（簽約）", "合約簽訂後 30 日內", "15",
             MilestoneState.RECEIVED, None),
            (2, "第二期（進料）", "主要鋼材進廠並經監造查驗", "25",
             MilestoneState.INVOICED, None),
            (3, "第三期（出貨安裝）", "構件運抵工地並完成吊裝", "40",
             MilestoneState.CLAIMABLE, None),
            (4, "第四期（驗收）", "全案完工並經業主驗收合格", "20",
             MilestoneState.PENDING, today + timedelta(days=75)),
        ]
        for seq, label, condition, pct, state, expected in milestone_specs:
            m, created = BillingMilestone.objects.update_or_create(
                project=guyue, seq=seq,
                defaults={
                    "label": label, "condition": condition,
                    "percentage": Decimal(pct), "state": state,
                    "expected_date": expected,
                },
            )
            m.recalc_amount() if state in (MilestoneState.PENDING, MilestoneState.CLAIMABLE) \
                else self._force_amount(m, guyue, pct)
            if created:
                self._backfill_dates(m, today, finance)

        # 追蹤單元：鋼構批次 3 筆＋土建工項 2 筆，散在不同站
        for name, stage, qty_total, qty_done, status_, note in [
            ("第一期-1F鋼柱 80支", "done", "80", "80", Status.ONTRACK, ""),
            ("第一期-樓板鋼樑 120支", "install", "120", "45", Status.ONTRACK, ""),
            ("第二期-樓梯鋼構", "fab", "36", "12", Status.ATRISK, "等噴砂廠回料"),
        ]:
            TrackingUnit.objects.update_or_create(
                project=guyue, name=name,
                defaults={
                    "unit_type": UnitType.BATCH, "template": steel_tpl,
                    "current_stage": steel_tpl.stages.get(code=stage),
                    "qty_total": Decimal(qty_total), "qty_done": Decimal(qty_done),
                    "unit_of_measure": "支", "status": status_, "note": note,
                    "stage_entered_at": timezone.now() - timedelta(days=12),
                },
            )
        for name, stage, pct, status_ in [
            ("B區基礎工程", "done", "100", Status.ONTRACK),
            ("B區結構體", "build", "65", Status.ONTRACK),
        ]:
            TrackingUnit.objects.update_or_create(
                project=guyue, name=name,
                defaults={
                    "unit_type": UnitType.WORK_ITEM, "template": civil_tpl,
                    "current_stage": civil_tpl.stages.get(code=stage),
                    "progress_pct": Decimal(pct), "status": status_,
                    "subcontractor": Vendor.objects.get(code="V005"),
                },
            )

        # ── 彰化食品廠房：剛開工 ──
        changhua, _ = Project.objects.update_or_create(
            name="彰化食品廠房擴建",
            defaults={
                "project_type": ProjectType.STEEL,
                "customer": Customer.objects.get(code="C002"),
                "contract_amount": Decimal("32000000"),
                "owner": owner,
                "start_date": date(2026, 2, 15), "due_date": date(2026, 10, 20),
                "main_template": main_tpl,
                "main_stage": main_tpl.stages.get(code="build"),
                "status": Status.ATRISK, "note": "鋼柱待料，需追料",
            },
        )
        for seq, label, pct, state, expected in [
            (1, "第一期（簽約）", "30", MilestoneState.RECEIVED, None),
            (2, "第二期（出貨）", "40", MilestoneState.PENDING, today + timedelta(days=30)),
            (3, "第三期（驗收）", "30", MilestoneState.PENDING, today + timedelta(days=90)),
        ]:
            m, created = BillingMilestone.objects.update_or_create(
                project=changhua, seq=seq,
                defaults={
                    "label": label, "percentage": Decimal(pct),
                    "state": state, "expected_date": expected,
                },
            )
            m.recalc_amount() if state == MilestoneState.PENDING \
                else self._force_amount(m, changhua, pct)
            if created:
                self._backfill_dates(m, today, finance)
        TrackingUnit.objects.update_or_create(
            project=changhua, name="第一期-H型鋼柱",
            defaults={
                "unit_type": UnitType.BATCH, "template": steel_tpl,
                "current_stage": steel_tpl.stages.get(code="wait"),
                "qty_total": Decimal("32"), "qty_done": Decimal("0"),
                "unit_of_measure": "支", "status": Status.ATRISK, "note": "等鋼材到料",
                "stage_entered_at": timezone.now() - timedelta(days=20),
            },
        )

        # ── 南投國道橋樑：收尾中 ──
        nantou, _ = Project.objects.update_or_create(
            name="南投國道橋樑鋼構",
            defaults={
                "project_type": ProjectType.STEEL,
                "customer": Customer.objects.get(code="C003"),
                "contract_amount": Decimal("54000000"),
                "owner": owner,
                "start_date": date(2025, 9, 1), "due_date": date(2026, 9, 15),
                "main_template": main_tpl,
                "main_stage": main_tpl.stages.get(code="verify"),
                "status": Status.ONTRACK,
            },
        )
        for seq, label, pct, state, expected in [
            (1, "第一期（開工）", "20", MilestoneState.RECEIVED, None),
            (2, "第二期（吊裝完成）", "50", MilestoneState.RECEIVED, None),
            (3, "尾款（驗收）", "30", MilestoneState.CLAIMABLE, None),
        ]:
            m, created = BillingMilestone.objects.update_or_create(
                project=nantou, seq=seq,
                defaults={
                    "label": label, "percentage": Decimal(pct),
                    "state": state, "expected_date": expected,
                },
            )
            self._force_amount(m, nantou, pct)
            if created:
                self._backfill_dates(m, today, finance)
        TrackingUnit.objects.update_or_create(
            project=nantou, name="主橋段鋼箱樑",
            defaults={
                "unit_type": UnitType.BATCH, "template": steel_tpl,
                "current_stage": steel_tpl.stages.get(code="done"),
                "qty_total": Decimal("18"), "qty_done": Decimal("18"),
                "unit_of_measure": "組", "status": Status.ONTRACK,
            },
        )

        self.stdout.write("    3 個專案、10 筆應收款、7 個追蹤單元")

    @staticmethod
    def _force_amount(milestone, project, pct):
        """已請款／已收款的列不能走 recalc（它會拒絕改），直接寫入正確金額"""
        amount = (project.effective_amount * Decimal(pct) / Decimal("100")).quantize(Decimal("1"))
        if milestone.amount != amount:
            milestone.amount = amount
            milestone.save(update_fields=["amount", "updated_at"])

    @staticmethod
    def _backfill_dates(milestone, today, actor):
        """依狀態補上合理的日期與歷程，讓畫面第一眼就是「用了一陣子」的樣子"""
        customer = milestone.project.customer
        state = milestone.state
        if state == MilestoneState.RECEIVED:
            milestone.invoice_date = today - timedelta(days=100)
            milestone.invoice_no = f"INV-{milestone.project_id}{milestone.seq:02d}"
            milestone.due_date = terms_service.due_date(
                milestone.invoice_date, customer.payment_term_type, customer.payment_term_days,
            )
            milestone.receive_date = milestone.due_date
        elif state == MilestoneState.INVOICED:
            milestone.invoice_date = today - timedelta(days=20)
            milestone.invoice_no = f"INV-{milestone.project_id}{milestone.seq:02d}"
            milestone.due_date = terms_service.due_date(
                milestone.invoice_date, customer.payment_term_type, customer.payment_term_days,
            )
        elif state == MilestoneState.CLAIMABLE:
            # 刻意放超過 7 天——「需要關注」的「放著沒開單」提醒要有東西可看
            milestone.claimable_at = timezone.now() - timedelta(days=10)
        milestone.save()
        MilestoneLog.objects.get_or_create(
            milestone=milestone, to_state=state,
            defaults={
                "from_state": "", "amount_snapshot": milestone.amount, "changed_by": actor,
            },
        )

    # ── 應付 ───────────────────────────────────────────────────────
    def _seed_payables(self):
        """讓現金流預測一開始就有東西可看。

        金額與日期刻意排成「近月會缺錢」——現金流畫面的重點是那一格，
        示範資料裡沒有缺口的話，看的人不會知道它長什麼樣、要做什麼。
        """
        from main.apps.payables.models import Payable, PayableLog, Subcontract
        from main.utils.choices import PayableState, PaymentMethod

        self.stdout.write("\n▸ 分包合約與應付款項")
        today = timezone.localdate()
        owner = User.objects.get(username="owner")

        guyue = Project.objects.get(name="固越企業總部新建工程")

        specs = [
            ("V001", "第一期鋼材採購", SubcontractCategory.MATERIAL, "18000000",
             PaymentTermType.MONTH_END, 60, "0"),
            ("V002", "構件表面處理（噴砂＋鍍鋅）", SubcontractCategory.OUTSOURCE, "3200000",
             PaymentTermType.FROM_INVOICE, 30, "0"),
            ("V005", "B區土建工程", SubcontractCategory.SUBCONTRACT, "12000000",
             PaymentTermType.MONTH_END, 60, "5"),
            ("V003", "構件運輸（板車）", SubcontractCategory.TRANSPORT, "1800000",
             PaymentTermType.MONTH_END, 30, "0"),
        ]
        contracts = {}
        for vendor_code, title, category, amount, term, days, retention in specs:
            contract, _ = Subcontract.objects.update_or_create(
                project=guyue, vendor=Vendor.objects.get(code=vendor_code), title=title,
                defaults={
                    "category": category, "contract_amount": Decimal(amount),
                    "payment_term_type": term, "payment_term_days": days,
                    "retention_pct": Decimal(retention),
                    "start_date": today - timedelta(days=90),
                    "end_date": today + timedelta(days=150),
                    "created_by": owner,
                },
            )
            contracts[vendor_code] = contract

        # (合約, 項目, 未稅金額, 計價日距今幾天, 狀態, 付款方式, 票期距今幾天)
        rows = [
            ("V001", "1月份鋼材", "6500000", -50, PayableState.PAID, PaymentMethod.TRANSFER, None),
            # ★ 支票：開票日跟兌現日差 75 天。現金流要落在兌現那一週，不是開票那一週
            ("V001", "2月份鋼材", "5800000", -20, PayableState.APPROVED, PaymentMethod.CHECK, 55),
            ("V002", "第一批噴砂鍍鋅", "1250000", -15, PayableState.APPROVED,
             PaymentMethod.TRANSFER, None),
            ("V005", "B區土建第二期計價", "4200000", -10, PayableState.APPROVED,
             PaymentMethod.TRANSFER, None),
            ("V005", "B區土建第三期計價", "3800000", -2, PayableState.PENDING,
             PaymentMethod.TRANSFER, None),
            ("V003", "8月運費", "180000", -3, PayableState.PENDING, PaymentMethod.TRANSFER, None),
        ]
        for vendor_code, title, amount, offset, state, method, check_offset in rows:
            contract = contracts[vendor_code]
            billing_date = today + timedelta(days=offset)
            payable, created = Payable.objects.update_or_create(
                subcontract=contract, title=title,
                defaults={
                    "project": contract.project, "vendor": contract.vendor,
                    "category": contract.category, "amount": Decimal(amount),
                    "tax_amount": (Decimal(amount) * Decimal("0.05")).quantize(Decimal("1")),
                    "retention_amount": (
                        Decimal(amount) * contract.retention_pct / 100
                    ).quantize(Decimal("1")),
                    "billing_date": billing_date,
                    "due_date": terms_service.due_date(
                        billing_date, contract.payment_term_type, contract.payment_term_days,
                    ),
                    "state": state, "payment_method": method,
                    "check_due_date": (
                        today + timedelta(days=check_offset) if check_offset else None
                    ),
                    "check_no": "AB0012345" if check_offset else "",
                    "paid_date": billing_date + timedelta(days=30)
                    if state == PayableState.PAID else None,
                    "created_by": owner,
                },
            )
            if created:
                PayableLog.objects.create(
                    payable=payable, from_state="", to_state=payable.state,
                    amount_snapshot=payable.payable_amount, changed_by=owner,
                )

        self.stdout.write(f"    {len(specs)} 張分包合約、{len(rows)} 筆應付款項")

    # ── 導覽 ───────────────────────────────────────────────────────
    def _print_guide(self):
        self.stdout.write("""
────────────────────────────────────────────
示範資料導覽
  · 專案分頁：固越案已施工中，展開可看到應收款四種狀態各一列
  · 金流分頁：應收（等收）、應付（等付，含一張支票）、現金流預測
  · 總覽：需要關注清單有「可請款放 10 天沒開單」與「等料卡住」
帳號：owner（經營者）、finance（會計）、admin（超級使用者）
────────────────────────────────────────────""")
