"""
示範資料（2026-08-14 流程制）：一個案子走完整條流程

  · 固越總部　　簽約後施工中：
      階段 1–3 全部完成、階段 4 由三張構件批次自動彙總、4.5 吊裝進行中
      應收四期鋪滿四種狀態（已收款／已請款／可請款／未到）
      應付掛在流程上（鋼材→3.4、噴砂→4.2、運費→4.3），含一張支票

刻意只留一個案子——看懂一個案子怎麼跑，比五個案子擠在畫面上有用。
帳號名冊見 seed_accounts（D40：經理／會計師／繪圖師／行政人員／工廠員工×10）。
⚠️ 僅供開發與教育訓練使用，正式上線前請清除。
"""
from datetime import date, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from main.apps.billing.models import BillingMilestone, MilestoneLog
from main.apps.core.models import User
from main.apps.masters.models import Customer, FlowItem, StageTemplate, Vendor
from main.apps.payables.services import terms_service
from main.apps.projects.models import Project
from main.apps.tracking.models import FlowUnit, TrackingUnit
from main.apps.tracking.services import flow_service
from main.utils.choices import (
    FlowState,
    MilestoneState,
    PaymentTermType,
    ProjectLifecycle,
    ProjectType,
    Status,
    SubcontractCategory,
    TemplateAppliesTo,
    UnitType,
    VendorType,
)

S1_S2 = ["1.1", "1.2", "1.3", "2.1", "2.2", "2.3"]
ALL_FLOWS = S1_S2 + ["3.1", "3.2", "3.3", "3.4",
                     "4.1", "4.2", "4.3", "4.4", "4.5",
                     "5.1", "5.2", "5.3", "5.4"]


class Command(BaseCommand):
    help = "載入示範資料（單案，流程制）。僅供開發與教育訓練"

    def add_arguments(self, parser):
        parser.add_argument("--clear", action="store_true", help="先清除既有示範資料")

    @transaction.atomic
    def handle(self, *args, **options):
        if options["clear"]:
            self._clear()

        if not FlowItem.objects.exists():
            self.stderr.write(self.style.ERROR("請先執行：python manage.py seed_masters"))
            return
        if not User.objects.filter(username="manager").exists():
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
        """刪除順序由 PROTECT 外鍵決定：應付 → 分包合約 → 專案（連帶其餘）"""
        from main.apps.core.models import Notification
        from main.apps.payables.models import Payable, PayableLog, Subcontract

        self.stdout.write("清除既有示範資料…")
        PayableLog.objects.all().delete()
        Payable.objects.all().delete()
        Subcontract.objects.all().delete()
        Project.objects.all().delete()  # cascade：應收款、流程單元、批次、歷程、變更單
        Notification.objects.all().delete()
        self.stdout.write("  完成\n")

    # ── 主檔 ───────────────────────────────────────────────────────
    def _seed_customers_vendors(self):
        self.stdout.write("\n▸ 客戶與廠商")
        for code, name, tax, term, days in [
            ("C001", "固越企業", "12345678", PaymentTermType.MONTH_END, 60),
            ("C002", "統一食品", "23456789", PaymentTermType.MONTH_END, 30),
            # 公家機關通常是驗收後起算
            ("C003", "國工局", "", PaymentTermType.FROM_ACCEPTANCE, 45),
            ("C004", "草屯農會", "34567890", PaymentTermType.MONTH_END, 30),
        ]:
            Customer.objects.update_or_create(
                code=code,
                defaults={
                    "name": name, "tax_id": tax,
                    # 帳期是現金流收入側的來源。各家刻意不同，才看得出差別
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
        self.stdout.write("    4 個客戶、4 家廠商")

    # ── 流程單元 ───────────────────────────────────────────────────
    def _seed_flows(self, project, codes, start, end, done=(), doing=None,
                    overdue=(), skip_rollup_codes=("4.1", "4.2", "4.3", "4.5")):
        """生成流程單元並排出甘特能看的日期。

        日期沿工期平均鋪、尾端疊 30%；完成的單元實際日＝預計日。
        批次彙總的四個單元（skip_rollup_codes）只給日期，狀態交給 sync_batch_rollup。
        """
        doing = doing or {}
        items = list(FlowItem.objects.filter(code__in=codes).order_by("seq"))
        total_days = max((end - start).days, len(items) * 3)
        span = total_days / len(items)
        units = {}
        for i, item in enumerate(items):
            plan_start = start + timedelta(days=int(span * i))
            plan_end = start + timedelta(days=int(span * (i + 1.3)))
            if item.code in overdue:
                plan_end = timezone.localdate() - timedelta(days=5)

            state = FlowState.TODO
            actual_start = actual_end = None
            if item.code in done and item.code not in skip_rollup_codes:
                state = FlowState.DONE
                actual_start, actual_end = plan_start, plan_end
            elif item.code in doing:
                state = FlowState.DOING
                actual_start = plan_start

            unit, _ = FlowUnit.objects.update_or_create(
                project=project, flow_item=item,
                defaults={
                    "state": state,
                    "plan_start": plan_start, "plan_end": plan_end,
                    "actual_start": actual_start, "actual_end": actual_end,
                    "assignee": doing.get(item.code),
                    "detail": "",
                    # D40：單元的工作內容等欄位從目錄抄預設值
                    "description": item.description,
                    "deliverables": item.deliverables,
                    "done_criteria": item.done_criteria,
                    # D49：順序與大階段記在單元上
                    "seq": item.seq * 10,
                    "stage": item.stage,
                },
            )
            units[item.code] = unit
        return units

    # ── 專案 ───────────────────────────────────────────────────────
    def _seed_projects(self):
        self.stdout.write("\n▸ 專案")
        today = timezone.localdate()
        owner = User.objects.get(username="manager")
        finance = User.objects.get(username="accountant")
        drafter = User.objects.get(username="drafter")
        foreman = User.objects.get(username="worker01")
        steel_tpl = StageTemplate.default_for(TemplateAppliesTo.STEEL_BATCH)

        def stage(code):
            return steel_tpl.stages.get(code=code)

        # ── 固越總部：簽約後施工中，批次散在四站 ──
        guyue, _ = Project.objects.update_or_create(
            name="固越企業總部新建工程",
            defaults={
                "project_type": ProjectType.STEEL,
                "customer": Customer.objects.get(code="C001"),
                "contract_amount": Decimal("80000000"),
                "owner": owner,
                "start_date": date(2026, 1, 10), "due_date": date(2026, 11, 30),
                "lifecycle": ProjectLifecycle.ACTIVE,
                "status": Status.ONTRACK,
                "contract_terms": "工期 300 日曆天；付款：簽約 15%、進料 25%、出貨安裝 40%、驗收 20%",
            },
        )
        gu_units = self._seed_flows(
            guyue, ALL_FLOWS, date(2026, 1, 10), date(2026, 11, 30),
            done=S1_S2 + ["3.1", "3.2", "3.3", "3.4", "4.4"],
            doing={"4.5": foreman},
        )
        gu_units["3.2"].assignee = drafter
        gu_units["3.2"].save(update_fields=["assignee"])
        # D43：詳細內容已併入工作內容——補充說明直接寫進 description
        gu_units["4.4"].description += "\n\n配合永固土建灌漿時程，預埋提前完成（複測合格）"
        gu_units["4.4"].save(update_fields=["description"])

        for name, st, qty_total, qty_done, status_, note in [
            ("第一期-1F鋼柱 80支", "installed", "80", "80", Status.ONTRACK, ""),
            ("第一期-樓板鋼樑 120支", "shipped", "120", "0", Status.ONTRACK, "到場待吊裝"),
            ("第二期-樓梯鋼構", "surfacing", "36", "12", Status.ATRISK, "等鍍鋅回廠"),
        ]:
            TrackingUnit.objects.update_or_create(
                project=guyue, name=name,
                defaults={
                    "unit_type": UnitType.BATCH, "template": steel_tpl,
                    "current_stage": stage(st),
                    "qty_total": Decimal(qty_total), "qty_done": Decimal(qty_done),
                    "unit_of_measure": "支", "status": status_, "note": note,
                    "stage_entered_at": timezone.now() - timedelta(days=12),
                },
            )
        flow_service.sync_batch_rollup(guyue)

        for seq, label, condition, pct, state, trigger, expected in [
            (1, "第一期（簽約）", "合約簽訂後 30 日內", "15", MilestoneState.RECEIVED, None, None),
            (2, "第二期（進料）", "主要鋼材進廠並經監造查驗", "25", MilestoneState.INVOICED,
             gu_units["3.4"], None),
            (3, "第三期（出貨安裝）", "構件運抵工地並完成吊裝", "40", MilestoneState.CLAIMABLE,
             gu_units["4.3"], None),
            (4, "第四期（驗收）", "全案完工並經業主驗收合格", "20", MilestoneState.PENDING,
             gu_units["5.2"], today + timedelta(days=75)),
        ]:
            self._milestone(guyue, seq, label, condition, pct, state, trigger, expected,
                            today, finance)

        self.stdout.write("    1 個專案（固越）、4 筆應收款、3 張批次、19 張流程單元")

    def _milestone(self, project, seq, label, condition, pct, state, trigger, expected,
                   today, actor):
        m, created = BillingMilestone.objects.update_or_create(
            project=project, seq=seq,
            defaults={
                "label": label, "condition": condition,
                "percentage": Decimal(pct), "state": state,
                "trigger_unit": trigger, "expected_date": expected,
            },
        )
        if state in (MilestoneState.PENDING, MilestoneState.CLAIMABLE):
            m.recalc_amount()
        else:
            self._force_amount(m, project, pct)
        if created:
            self._backfill_dates(m, today, actor)

    @staticmethod
    def _force_amount(milestone, project, pct):
        """已請款／已收款的列不能走 recalc（它會拒絕改），直接寫入正確金額"""
        amount = (project.amount_base * Decimal(pct) / Decimal("100")).quantize(Decimal("1"))
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
        """讓現金流預測一開始就有東西可看，且每筆錢掛回它花在哪個流程。

        金額與日期刻意排成「近月會缺錢」——現金流畫面的重點是那一格。
        """
        from main.apps.payables.models import Payable, PayableLog, Subcontract
        from main.utils.choices import PayableState, PaymentMethod

        self.stdout.write("\n▸ 分包合約與應付款項")
        today = timezone.localdate()
        owner = User.objects.get(username="manager")

        guyue = Project.objects.get(name="固越企業總部新建工程")
        flow = {u.flow_item.code: u for u in guyue.flow_units.select_related("flow_item")}

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

        # (合約, 項目, 未稅金額, 計價日距今幾天, 狀態, 付款方式, 票期距今幾天, 掛哪個流程)
        rows = [
            ("V001", "1月份鋼材", "6500000", -50, PayableState.PAID,
             PaymentMethod.TRANSFER, None, "3.4"),
            # ★ 支票：開票日跟兌現日差 75 天。現金流要落在兌現那一週，不是開票那一週
            ("V001", "2月份鋼材", "5800000", -20, PayableState.APPROVED,
             PaymentMethod.CHECK, 55, "3.4"),
            ("V002", "第一批噴砂鍍鋅", "1250000", -15, PayableState.APPROVED,
             PaymentMethod.TRANSFER, None, "4.2"),
            ("V005", "B區土建第二期計價", "4200000", -10, PayableState.APPROVED,
             PaymentMethod.TRANSFER, None, None),
            ("V005", "B區土建第三期計價", "3800000", -2, PayableState.PENDING,
             PaymentMethod.TRANSFER, None, None),
            ("V003", "8月運費", "180000", -3, PayableState.PENDING,
             PaymentMethod.TRANSFER, None, "4.3"),
        ]
        for vendor_code, title, amount, offset, state, method, check_offset, flow_code in rows:
            contract = contracts[vendor_code]
            billing_date = today + timedelta(days=offset)
            payable, created = Payable.objects.update_or_create(
                subcontract=contract, title=title,
                defaults={
                    "project": contract.project, "vendor": contract.vendor,
                    "flow_unit": flow.get(flow_code) if flow_code else None,
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
示範資料導覽（只有固越一案，看懂一案就看懂全部）
  · 專案分頁：點開固越案——五大階段排程表、批次自動彙總、應收四期
  · 追蹤看板：流程看板（卡在哪一步）、構件批次（七站）、日曆甘特
  · 我的任務：worker01（工廠員工1）登入看 4.5 現場吊裝（進行中）
  · 金流分頁：應收（第三期可請款放 10 天）、應付（掛流程、含一張支票）、現金流
帳號：manager（經理）、accountant（會計師）、drafter／clerk／worker01–10（員工）、admin
各帳號密碼見 docs/帳號密碼.md
────────────────────────────────────────────""")
