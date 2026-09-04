"""
示範資料（2026-08-14 流程制；2026-08-30 補 D49–D52 全功能覆蓋）

  · 固越總部　　簽約後施工中：
      階段 1–3 全部完成、階段 4 由三張構件批次自動彙總、4.5 吊裝進行中
      應收四期鋪滿四種狀態（已收款／已請款／可請款／未到）
      應付掛在流程上（鋼材→3.4、噴砂→4.2、運費→4.3），含一張支票
      D52：工作分配（含未開始／進行中／完成三態）＋三週回報流水帳→產能統計、
      　　　鋼材三次採購拆明細（單價 48000→51500→52000 ↗）→單價走勢、
      　　　工數補登修正示範（繪圖師）、公司現有現金
      D49/D51：自訂流程「舊廠房鋼棚拆除」＋位置制編號重編
  · 統一食品　　估價中（只有階段 1）：估價金額走「預估級」現金流

主案只有固越——看懂一個案子怎麼跑，比五個案子擠在畫面上有用。
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
        self._seed_capacity()   # D52：工作類型／分配回報／品項明細／現金
        self._seed_affairs()    # D53：行政例行與臨時事項
        self.stdout.write(self.style.SUCCESS("\n✔ 示範資料載入完成"))
        self._print_guide()

    # ── 清除 ───────────────────────────────────────────────────────
    def _clear(self):
        """刪除順序由 PROTECT 外鍵決定：應付 → 專案 → 被引用的主檔"""
        from main.apps.affairs.models import AffairRule, AffairTask
        from main.apps.core.models import ActivityLog, Attachment, Notification
        from main.apps.masters.models import MaterialItem, WorkType
        from main.apps.payables.models import CashBalance, Payable, PayableLog, Subcontract

        self.stdout.write("清除既有示範資料…")
        # 行政（D53）：待辦先於規則，類別是主檔（保留，由 migration 建的三個預設）
        AffairTask.objects.all().delete()
        AffairRule.objects.all().delete()
        PayableLog.objects.all().delete()
        Payable.objects.all().delete()   # cascade：明細列
        Subcontract.objects.all().delete()
        Project.objects.all().delete()  # cascade：應收款、流程單元、工作項目、分配、回報、批次、歷程、變更單
        # 被 PROTECT 的主檔要等引用它的資料先刪光（D52）
        WorkType.objects.all().delete()
        MaterialItem.objects.all().delete()
        CashBalance.objects.all().delete()
        Notification.objects.all().delete()
        Attachment.objects.all().delete()
        ActivityLog.objects.all().delete()
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
        # 只撈預設模板的目錄——D49 起可能有多套模板，code 會重複
        from main.apps.masters.models import FlowTemplate

        items = list(
            FlowItem.objects.filter(
                code__in=codes, template=FlowTemplate.objects.get(is_default=True),
            ).order_by("seq")
        )
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

        # ── D49/D51：自訂流程＋位置制編號 ──
        if not guyue.flow_units.filter(name="舊廠房鋼棚拆除").exists():
            cu = FlowUnit.create_custom(guyue, "舊廠房鋼棚拆除", gu_units["1.1"].stage)
            cu.state = FlowState.DONE
            cu.plan_start, cu.plan_end = date(2026, 1, 12), date(2026, 1, 20)
            cu.actual_start, cu.actual_end = cu.plan_start, cu.plan_end
            cu.description = "進場前拆除既有鋼棚並清運——目錄上沒有的「自訂流程」示範（D49）"
            cu.save()
        flow_service.renumber_codes(guyue)

        # ── 統一食品：估價中——估價金額走「預估級」現金流 ──
        uni, _ = Project.objects.update_or_create(
            name="統一食品廠房增建工程",
            defaults={
                "project_type": ProjectType.STEEL,
                "customer": Customer.objects.get(code="C002"),
                "estimate_amount": Decimal("12500000"),
                "owner": owner,
                "start_date": today - timedelta(days=12),
                "due_date": today + timedelta(days=150),
                "lifecycle": ProjectLifecycle.ACTIVE,
                "status": Status.ONTRACK,
                "note": "還在估價；估價金額以「預估級」進現金流預測",
            },
        )
        self._seed_flows(
            uni, S1_S2[:3], today - timedelta(days=12), today + timedelta(days=25),
            done=["1.1"], doing={"1.2": drafter},
        )
        flow_service.renumber_codes(uni)

        self.stdout.write("    2 個專案（固越施工中＋統一估價中）、4 筆應收款、3 張批次、"
                          "20+3 張流程單元（含 1 條自訂）")

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
        flow = {
            u.flow_item.code: u
            for u in guyue.flow_units.filter(flow_item__isnull=False).select_related("flow_item")
        }

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
            ("V001", "3月份鋼材", "4700000", -5, PayableState.APPROVED,
             PaymentMethod.TRANSFER, None, "3.4"),
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

    # ── D52：產能與成本 ────────────────────────────────────────────
    def _seed_capacity(self):
        """工作類型／品項主檔、工作分配與三週回報流水帳、應付明細、公司現金。

        數字設計給統計頁看：
          · 切割兩人合計 160 支╱約 11.5 工 → 每工 ~14 支
          · 鋼材三次採購單價 48,000 → 51,500 → 52,000（↗ 越買越貴）
          · worker04 兩件分配同日都回報 → 當天 1 工均分示範
          · 繪圖師只回報 1 天但實畫 12 工 → 補登修正（man_days_override）示範
          · worker05 被分了工但還沒按「開始」→ 人員看板紅色「未開始」示範
        """
        from main.apps.core.models import Notification
        from main.apps.masters.models import MaterialItem, WorkType
        from main.apps.payables.models import CashBalance, Payable, PayableLine
        from main.apps.tracking.models import AssignmentReport, FlowTask, FlowTaskAssignment

        self.stdout.write("\n▸ D52：工作分配、回報流水帳與成本明細")
        today = timezone.localdate()
        users = {u.username: u for u in User.objects.all()}
        owner = users["manager"]

        wt = {}
        for name in ["切割", "焊接", "組立", "噴漆", "吊裝安裝", "繪圖", "泥作"]:
            wt[name], _ = WorkType.objects.get_or_create(name=name)
        items = {}
        for name, uom in [("鋼材", "噸"), ("高強度螺栓", "支"), ("混凝土", "m³"), ("防鏽漆", "桶")]:
            items[name], _ = MaterialItem.objects.get_or_create(
                name=name, defaults={"unit_of_measure": uom},
            )

        guyue = Project.objects.get(name="固越企業總部新建工程")
        unit = {
            u.flow_item.code: u
            for u in guyue.flow_units.filter(flow_item__isnull=False).select_related("flow_item")
        }

        def task(code, name, qty, uom, statuses):
            t, _ = FlowTask.objects.get_or_create(
                unit=unit[code], name=name,
                defaults={"qty": Decimal(qty), "unit_of_measure": uom, "statuses": statuses},
            )
            return t

        def assign(t, status, username, qty, work_type, series=(), override=None, note=""):
            """series＝[(幾天前, 回報量)]。回報寫進不可變流水帳，工數由此自動計。"""
            a, created = FlowTaskAssignment.objects.get_or_create(
                task=t, status=status, assignee=users[username],
                defaults={
                    "qty_assigned": Decimal(qty), "work_type": wt[work_type], "note": note,
                },
            )
            if not created:
                return a
            total = Decimal("0")
            dates = []
            for days_ago, delta in series:
                d = today - timedelta(days=days_ago)
                AssignmentReport.objects.create(
                    assignment=a, date=d, qty_delta=Decimal(delta),
                    reported_by=users[username],
                )
                total += Decimal(delta)
                dates.append(d)
            if dates:
                a.qty_done = min(total, a.qty_assigned)
                a.started_at = min(dates)
                if a.qty_done >= a.qty_assigned:
                    a.completed_at = max(dates)
            if override is not None:
                a.man_days_override = Decimal(override)
            a.save()
            return a

        t_col = task("4.1", "鋼柱構件", "200", "支", ["切割中", "焊接中"])
        t_beam = task("4.1", "鋼樑構件", "150", "支", ["焊接中"])
        t_hoist = task("4.5", "鋼樑吊裝", "120", "支", ["吊裝中"])
        t_draw = task("3.2", "施工圖繪製", "30", "張", ["繪製中"])

        # 切割：worker02 做完（8 個回報日）、worker03 進行中
        assign(t_col, "切割中", "worker02", "100", "切割",
               [(21, "12"), (20, "14"), (19, "12"), (16, "13"), (15, "12"),
                (14, "13"), (13, "12"), (12, "12")])
        assign(t_col, "切割中", "worker03", "100", "切割",
               [(6, "15"), (5, "15"), (4, "16"), (2, "14")],
               note="留意 3F 柱腳板厚改 22mm，下料前先對圖")
        # worker04 兩件分配、同日都有回報（3、2 天前）→ 當天 1 工各記 0.5
        assign(t_col, "焊接中", "worker04", "120", "焊接",
               [(9, "18"), (8, "18"), (7, "18"), (3, "9"), (2, "9")])
        assign(t_beam, "焊接中", "worker04", "80", "焊接",
               [(3, "10"), (2, "10")])
        # 吊裝：worker01 今天有回報（看板亮「今日已回報」）、worker05 還沒按開始（紅）
        assign(t_hoist, "吊裝中", "worker01", "60", "吊裝安裝",
               [(4, "8"), (3, "9"), (1, "9"), (0, "9")],
               note="吊裝前確認當日風速，超過 10m/s 停工")
        assign(t_hoist, "吊裝中", "worker05", "60", "吊裝安裝",
               note="吊裝前確認當日風速，超過 10m/s 停工")
        # 繪圖：一次回報完，但實畫 12 工 → 經理補登修正
        assign(t_draw, "繪製中", "drafter", "30", "繪圖", [(40, "30")], override="12")

        # 應付明細：鋼材三次採購拆明細（合計＝各單金額），單價統計的資料源
        lines_spec = {
            "1月份鋼材": [("鋼材", "130", "48000"), ("高強度螺栓", "2600", "100")],
            "2月份鋼材": [("鋼材", "110", "51500"), ("高強度螺栓", "1350", "100")],
            "3月份鋼材": [("鋼材", "90", "52000"), ("高強度螺栓", "200", "100")],
        }
        for title, line_rows in lines_spec.items():
            payable = Payable.objects.get(title=title)
            if not payable.lines.exists():
                for item_name, qty, price in line_rows:
                    PayableLine.objects.create(
                        payable=payable, item=items[item_name],
                        qty=Decimal(qty), unit_price=Decimal(price),
                    )

        # 公司現有現金（D49；只有經理與系統管理員看得到）
        balance = CashBalance.get()
        balance.amount = Decimal("8500000")
        balance.note = "示範數字——現金流預測的累計列從這裡起算"
        balance.updated_by = owner
        balance.save()

        # 幾則通知，鈴鐺才不是空的
        Notification.send([owner], "工廠員工2 完成了「鋼柱構件・切割中」的分量",
                          "切割中 100/200 支（50%）", "/tracking?view=staff")
        Notification.send([users["worker05"]], "你收到工作：鋼樑吊裝 吊裝中 60 支",
                          "📌 吊裝前確認當日風速，超過 10m/s 停工", "/mywork")

        self.stdout.write("    7 種工作類型、4 個品項、7 份分配（三週回報流水帳）、"
                          "3 張明細單、現金 850 萬")

    # ── 行政（D53）─────────────────────────────────────────────────
    def _seed_affairs(self):
        """例行規則三條（每週／每月／每年）＋臨時事項數件。

        畫面上要看得到的：本月日曆有色塊、有已完成的（劃掉）、
        有一件逾期（紅字）、行政人員的「我的任務」有行政區塊。
        """
        from main.apps.affairs.models import AffairCategory, AffairRule, AffairTask
        from main.apps.affairs.services import schedule_service

        self.stdout.write("\n▸ D53：行政事項")
        today = timezone.localdate()
        users = {u.username: u for u in User.objects.all()}
        cat = {c.name: c for c in AffairCategory.objects.all()}
        for name, color in [("繳費", "#f59e0b"), ("打掃", "#10b981"), ("其他", "#64748b")]:
            if name not in cat:
                cat[name] = AffairCategory.objects.create(name=name, color=color)
        owner = users["manager"]
        clerk = users.get("clerk", owner)

        rules = [
            # 每週五全體大掃除（工廠員工三人）
            dict(title="辦公室與廠區清掃", category=cat["打掃"], freq="weekly",
                 weekdays=[4], note="含茶水間與廁所；垃圾當日清出",
                 people=[users["worker01"], users["worker02"], users["worker03"]]),
            # 每月 5 日繳網路費（D55：行政事項也能記金額，會進金流）
            dict(title="繳公司網路費", category=cat["繳費"], freq="monthly", month_day=5,
                 note="中華電信，網銀轉帳；帳號在保險箱資料夾",
                 amount=Decimal("2180"), direction="out", people=[clerk]),
            # 每年 5 月報稅
            dict(title="營所稅結算申報", category=cat["繳費"], freq="yearly",
                 year_month=5, year_day=31, note="會計師事務所會先寄試算表",
                 people=[users["accountant"], owner]),
        ]
        for spec in rules:
            people = spec.pop("people")
            rule, created = AffairRule.objects.get_or_create(
                title=spec["title"],
                defaults={**spec, "start_date": today - timedelta(days=60),
                          "created_by": owner},
            )
            if created:
                rule.assignees.set(people)
                schedule_service.materialize_rule(rule)

        # 臨時事項：一件已完成、一件逾期未做、一件下週。
        # 末兩欄是 D55 的金額與收支——0 代表純待辦，不進金流
        ad_hoc = [
            ("冷氣濾網清洗", cat["打掃"], -3, [users["worker04"]], "三樓辦公室兩台", True,
             Decimal("4500"), "out"),
            ("消防設備年度申報", cat["其他"], -1, [clerk], "逾期未辦會被罰，優先處理", False,
             Decimal("6000"), "out"),
            ("影印機碳粉叫貨", cat["其他"], 5, [clerk], "", False, Decimal("3200"), "out"),
            ("繳廠房電費", cat["繳費"], 2, [clerk], "台電；金額較大，先跟經理確認", False,
             Decimal("48600"), "out"),
        ]
        for title, category, offset, people, note, done, amount, direction in ad_hoc:
            task, created = AffairTask.objects.get_or_create(
                title=title,
                defaults={
                    "category": category, "date": today + timedelta(days=offset),
                    "note": note, "amount": amount, "direction": direction,
                    "created_by": owner,
                },
            )
            if created:
                task.assignees.set(people)
                if done:
                    task.is_done = True
                    task.done_by = people[0]
                    task.done_at = timezone.now() - timedelta(days=3)
                    task.save(update_fields=["is_done", "done_by", "done_at"])

        n = AffairTask.objects.count()
        self.stdout.write(f"    3 條例行規則（週／月／年）、4 件臨時事項，共展開 {n} 筆待辦")

    # ── 導覽 ───────────────────────────────────────────────────────
    def _print_guide(self):
        self.stdout.write("""
────────────────────────────────────────────
示範資料導覽（主案固越，估價中的統一案示範預估級現金流）
  · 專案分頁：點開固越案——排程表（含自訂流程「舊廠房鋼棚拆除」、位置制編號）、
    批次自動彙總、應收四期；點 4.1/4.5 看工作項目與分配（含工數）
  · 追蹤看板：流程看板、構件批次（七站）、員工視圖——
    worker05 亮紅色「未開始」、worker01 亮「進行中・今日已回報」
  · 我的任務：worker05 登入看「▶ 開始」按鈕與 📌 經理叮嚀；worker01 看進行中第 N 天
  · 金流分頁：應收（第三期可請款放 10 天）、應付（掛流程、含一張支票、
    三張鋼材單有明細）、現金流（表格＋時間軸；經理看得到現金 850 萬）
  · 統計分頁（經理）：產能（切割/焊接/吊裝有三週數據、繪圖有補登修正 12 工）、
    鋼材單價走勢 ↗（48000→51500→52000）、每類流程平均花費
  · 行政分頁（全員可看，經理維護）：日曆／條列兩種檢視——
    每週五清掃、每月 5 日繳網路費、每年 5/31 報稅，另有一件逾期（消防申報，紅字）
    與一件已完成（冷氣濾網，劃掉）；clerk 登入的「我的任務」有「📋 行政」區塊
  · 金流 → 收支明細（D55）：一天一天的收支流水帳，可切「全部／案子／行政」——
    行政那側就是每月網路費 2,180、廠房電費 48,600 這些
帳號：manager（經理）、accountant（會計師）、drafter／clerk／worker01–10（員工）、admin
各帳號密碼見 docs/帳號密碼.md
────────────────────────────────────────────""")
