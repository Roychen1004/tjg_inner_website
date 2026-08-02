"""
示範資料：固越企業總部案（完整鋼構案）＋ 彰化、南投兩案

固越案的四筆請款里程碑刻意用上四種不同的觸發方式，
方便一次看懂差別。

⚠️ 僅供開發與教育訓練使用，正式上線前請執行 flush 清除。
"""
from datetime import date
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from main.apps.assets.models import AssetUnit
from main.apps.billing.models import BillingMilestone
from main.apps.core.models import User
from main.apps.inventory.models import Location, Lot
from main.apps.masters.models import Customer, Item, ItemCategory, StageTemplate, Vendor
from main.apps.production.models import ProductionLine
from main.apps.projects.models import Project, ProjectPhase
from main.apps.tracking.models import TrackingUnit
from main.utils.choices import (
    AssetStatus,
    ItemKind,
    LocationType,
    LotStatus,
    ProfileType,
    ProjectType,
    Status,
    SurfaceTreatment,
    TemplateAppliesTo,
    TrackingMode,
    TriggerType,
    UnitType,
    VendorType,
    WorkMode,
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
        if not User.objects.filter(username="pm").exists():
            self.stderr.write(self.style.ERROR("請先執行：python manage.py seed_accounts"))
            return

        self.stdout.write(self.style.MIGRATE_HEADING("載入示範資料"))
        self._seed_customers_vendors()
        self._seed_locations()
        self._seed_items()
        self._seed_lots()
        self._seed_assets()
        self._seed_lines()
        self._seed_guyue()
        self._seed_other_projects()
        self.stdout.write(self.style.SUCCESS("\n✔ 示範資料載入完成"))
        self._print_guide()

    # ── 清除 ───────────────────────────────────────────────────────
    def _clear(self):
        """清除示範資料。

        刪除順序是被 PROTECT 外鍵決定的，不是隨便排的：
        出入庫紀錄 → 餘料 → 母批號。反過來會被資料庫擋下來——
        而那個「擋下來」正是我們要的：庫存不能在沒有紀錄的情況下憑空消失。
        """
        from main.apps.assets.models import AssetMovement
        from main.apps.inventory.models import StockTransaction

        self.stdout.write("清除既有示範資料…")
        Project.objects.all().delete()
        StockTransaction.objects.all().delete()
        AssetMovement.objects.all().delete()
        # 餘料的 parent_lot 是 PROTECT，必須先刪餘料才能刪母批號
        Lot.objects.filter(is_remnant=True).delete()
        Lot.objects.all().delete()
        AssetUnit.objects.all().delete()
        Item.objects.all().delete()
        ItemCategory.objects.all().delete()
        Location.objects.all().delete()
        Vendor.objects.all().delete()
        Customer.objects.all().delete()
        ProductionLine.objects.all().delete()

    # ── 主檔 ───────────────────────────────────────────────────────
    def _seed_customers_vendors(self):
        self.stdout.write("\n▸ 客戶與廠商")
        for code, name, tax in [
            ("C001", "固越企業", "12345678"),
            ("C002", "統一食品", "23456789"),
            ("C003", "國工局", ""),
        ]:
            Customer.objects.update_or_create(code=code, defaults={"name": name, "tax_id": tax})

        for code, name, types in [
            ("V001", "中鋼鋼鐵", [VendorType.SUPPLIER]),
            ("V002", "全興噴砂廠", [VendorType.OUTSOURCE, VendorType.SUPPLIER]),
            ("V003", "大發板車運輸", [VendorType.TRANSPORT]),
            ("V004", "宏運重車貨運", [VendorType.TRANSPORT]),
            ("V005", "永固土木包商", [VendorType.SUBCONTRACTOR]),
        ]:
            Vendor.objects.update_or_create(
                code=code, defaults={"name": name, "vendor_types": types},
            )
        self.stdout.write("    3 個客戶、5 家廠商")

    def _seed_locations(self):
        self.stdout.write("\n▸ 位置")
        wh, _ = Location.objects.update_or_create(
            code="WH-A", defaults={"name": "A 倉（原料）", "location_type": LocationType.WAREHOUSE},
        )
        for code, name in [("WH-A-1", "A倉1排"), ("WH-A-3", "A倉3排")]:
            Location.objects.update_or_create(
                code=code,
                defaults={"name": name, "location_type": LocationType.RACK, "parent": wh},
            )
        Location.objects.update_or_create(
            code="YARD", defaults={"name": "半成品置料區", "location_type": LocationType.YARD},
        )
        Location.objects.update_or_create(
            code="YARD-R", defaults={"name": "餘料區", "location_type": LocationType.YARD},
        )
        Location.objects.update_or_create(
            code="LOC-V002",
            defaults={
                "name": "全興噴砂廠",
                "location_type": LocationType.VENDOR,
                "vendor": Vendor.objects.get(code="V002"),
            },
        )
        self.stdout.write("    倉庫／儲位／置料區／餘料區／外包廠")

    def _seed_items(self):
        self.stdout.write("\n▸ 物品主檔")
        cats = {}
        for code, name, kind in [
            ("STEEL_PLATE", "鋼板", ItemKind.MATERIAL),
            ("STEEL_BEAM", "型鋼", ItemKind.MATERIAL),
            ("FASTENER", "螺栓五金", ItemKind.PART),
            ("WELDING", "焊材", ItemKind.PART),
            ("HAND_TOOL", "手工具", ItemKind.TOOL),
            ("MACHINE", "生產設備", ItemKind.EQUIPMENT),
        ]:
            cats[code], _ = ItemCategory.objects.update_or_create(
                code=code, defaults={"name": name, "item_kind": kind},
            )

        items = [
            # 料號, 品名, 分類, 類型, 追蹤, 單位, 料型, 材質, 尺寸dict, 單位重量
            ("PL-SS400-6", "鋼板 SS400", "STEEL_PLATE", ItemKind.MATERIAL, TrackingMode.QUANTITY,
             "張", ProfileType.PLATE, "SS400",
             {"thickness_mm": 6, "width_mm": 1524, "length_mm": 3048}, Decimal("218.500")),
            ("PL-SS400-9", "鋼板 SS400", "STEEL_PLATE", ItemKind.MATERIAL, TrackingMode.QUANTITY,
             "張", ProfileType.PLATE, "SS400",
             {"thickness_mm": 9, "width_mm": 1524, "length_mm": 3048}, Decimal("327.800")),
            ("HB-SN490-400", "H型鋼 SN490B", "STEEL_BEAM", ItemKind.MATERIAL, TrackingMode.QUANTITY,
             "支", ProfileType.H_BEAM, "SN490B",
             {"height_mm": 400, "width_mm": 200, "web_thickness_mm": 8,
              "flange_thickness_mm": 13, "length_mm": 6000}, Decimal("396.000")),
            ("HB-SN490-300", "H型鋼 SN490B", "STEEL_BEAM", ItemKind.MATERIAL, TrackingMode.QUANTITY,
             "支", ProfileType.H_BEAM, "SN490B",
             {"height_mm": 300, "width_mm": 150, "web_thickness_mm": 6.5,
              "flange_thickness_mm": 9, "length_mm": 6000}, Decimal("219.000")),
            ("BOLT-M20-70", "高強度螺栓 F10T", "FASTENER", ItemKind.PART, TrackingMode.QUANTITY,
             "組", ProfileType.BOLT, "F10T", {"diameter_mm": 20, "length_mm": 70}, Decimal("0.320")),
            ("WELD-E7016", "焊條 E7016 Ø3.2", "WELDING", ItemKind.PART, TrackingMode.QUANTITY,
             "kg", "", "", {}, None),
        ]
        for code, name, cat, kind, mode, uom, profile, grade, dims, weight in items:
            Item.objects.update_or_create(
                code=code,
                defaults={
                    "name": name, "category": cats[cat], "item_kind": kind,
                    "tracking_mode": mode, "unit_of_measure": uom,
                    "profile_type": profile, "material_grade": grade,
                    "standard": "CNS" if grade else "",
                    "unit_weight_kg": weight, "requires_mill_cert": bool(grade),
                    "surface_treatment": SurfaceTreatment.RAW,
                    "spec_label": "", **dims,
                },
            )

        for code, name, cat, kind in [
            ("TL-WELDER", "CO2 半自動電焊機", "MACHINE", ItemKind.EQUIPMENT),
            ("TL-TORQUE", "扭力扳手 700N·m", "HAND_TOOL", ItemKind.TOOL),
            ("TL-GRINDER", "手提砂輪機", "HAND_TOOL", ItemKind.TOOL),
        ]:
            Item.objects.update_or_create(
                code=code,
                defaults={
                    "name": name, "category": cats[cat], "item_kind": kind,
                    "tracking_mode": TrackingMode.INDIVIDUAL, "unit_of_measure": "台",
                },
            )
        self.stdout.write(f"    {Item.objects.count()} 個品項（含規格尺寸與單位重量）")

    def _seed_lots(self):
        self.stdout.write("\n▸ 批號庫存")
        wh1 = Location.objects.get(code="WH-A-1")
        wh3 = Location.objects.get(code="WH-A-3")
        remnant_yard = Location.objects.get(code="YARD-R")

        base, _ = Lot.objects.update_or_create(
            lot_no="L-2026-0338",
            defaults={
                "item": Item.objects.get(code="PL-SS400-6"), "location": wh3,
                "qty_on_hand": Decimal("12"), "qty_reserved": Decimal("8"),
                "status": LotStatus.RESERVED, "unit_cost": Decimal("36750"),
                "total_value": Decimal("441000"), "heat_no": "H240118A",
                "mill_cert_no": "MC-2026-0338",
                "received_date": date(2026, 5, 20), "last_move_date": date(2026, 6, 1),
            },
        )
        Lot.objects.update_or_create(
            lot_no="L-2026-0341",
            defaults={
                "item": Item.objects.get(code="HB-SN490-400"), "location": wh1,
                "qty_on_hand": Decimal("24"), "status": LotStatus.AVAILABLE,
                "unit_cost": Decimal("15840"), "total_value": Decimal("380160"),
                "heat_no": "H240203C", "mill_cert_no": "MC-2026-0341",
                "received_date": date(2026, 6, 5), "last_move_date": date(2026, 6, 5),
            },
        )
        # 餘料：從 L-2026-0338 切下來的料頭，長度只剩 1180mm
        Lot.objects.update_or_create(
            lot_no="L-2026-0338-R1",
            defaults={
                "item": Item.objects.get(code="PL-SS400-6"), "location": remnant_yard,
                "qty_on_hand": Decimal("3"), "status": LotStatus.AVAILABLE,
                "is_remnant": True, "parent_lot": base,
                "actual_length_mm": Decimal("1180"), "actual_width_mm": Decimal("1524"),
                "received_date": date(2026, 6, 10), "last_move_date": date(2026, 6, 18),
                "note": "1F鋼柱切割後餘料，可再利用",
            },
        )
        Lot.objects.update_or_create(
            lot_no="L-2025-0912",
            defaults={
                "item": Item.objects.get(code="PL-SS400-9"), "location": wh3,
                "qty_on_hand": Decimal("5"), "status": LotStatus.AVAILABLE,
                "received_date": date(2025, 9, 12), "last_move_date": date(2025, 9, 12),
                "note": "久未動用",
            },
        )
        self.stdout.write(f"    {Lot.objects.count()} 個批號（含 1 筆餘料、1 筆呆滯料）")

    def _seed_assets(self):
        self.stdout.write("\n▸ 個體資產")
        wh1 = Location.objects.get(code="WH-A-1")
        worker = User.objects.get(username="worker")
        for asset_no, item_code, brand, model, status, holder, cal_due in [
            ("TL-0031", "TL-WELDER", "OTC", "DM-350", AssetStatus.IN_USE, worker, None),
            ("TL-0044", "TL-TORQUE", "Tohnichi", "QL700N", AssetStatus.IDLE, None, date(2026, 8, 20)),
            ("TL-0052", "TL-GRINDER", "Makita", "GA5030", AssetStatus.IDLE, None, None),
        ]:
            AssetUnit.objects.update_or_create(
                asset_no=asset_no,
                defaults={
                    "item": Item.objects.get(code=item_code), "brand": brand, "model": model,
                    "location": wh1, "asset_status": status, "holder": holder,
                    "calibration_due_date": cal_due, "purchase_date": date(2024, 3, 1),
                    "purchase_cost": Decimal("48000"),
                },
            )
        self.stdout.write("    3 件工具設備（1 件校驗即將到期）")

    def _seed_lines(self):
        self.stdout.write("\n▸ 產線")
        for i, (code, name, status, wo, util, out) in enumerate([
            ("L01", "雷射切割線 (HSG TLS)", "run", "固越-第二期", 78, "5.2 噸"),
            ("L02", "CNC 鑽孔線", "changeover", "—", 62, "3.1 噸"),
            ("L03", "組裝焊接區", "run", "固越-第二期", 71, "—"),
            ("L04", "塗裝線", "run", "南投-A區", 85, "—"),
            ("L05", "品檢工作站", "idle", "—", 45, "—"),
        ]):
            ProductionLine.objects.update_or_create(
                code=code,
                defaults={
                    "name": name, "status": status, "current_work": wo,
                    "utilization": Decimal(util), "today_output": out, "sort_order": i,
                },
            )
        self.stdout.write("    5 條產線")

    # ── 固越案（主要示範）───────────────────────────────────────────
    def _seed_guyue(self):
        self.stdout.write("\n▸ 固越企業總部案（主要示範）")
        main_tpl = StageTemplate.default_for(TemplateAppliesTo.PROJECT_MAIN)
        steel_tpl = StageTemplate.default_for(TemplateAppliesTo.STEEL_BATCH)
        pm = User.objects.get(username="pm")

        project, _ = Project.objects.update_or_create(
            code="P-2026-001",
            defaults={
                "name": "固越企業總部案",
                "project_type": ProjectType.STEEL,
                "customer": Customer.objects.get(code="C001"),
                "contract_amount": Decimal("80000000"),
                "owner": pm,
                "start_date": date(2026, 3, 15),
                "due_date": date(2026, 11, 30),
                "main_template": main_tpl,
                "main_stage": main_tpl.stages.get(code="build"),
                "status": Status.ONTRACK,
                "note": "三期並行，第一期安裝中",
                "contract_terms": (
                    "工期：2026/03/15–11/30\n"
                    "請款：訂金 30%／第一期進場簽收 30%／第二期進場 30%／尾款 10%\n"
                    "交貨地點：固越企業總部工地\n"
                    "逾期罰則：每日合約額 0.1%　保固一年"
                ),
                "quote_info": "報價單 GY-2026-014：鋼構總重約 420 噸，含深化設計、加工、表面處理、運輸、安裝",
            },
        )

        # 工地位置
        site, _ = Location.objects.update_or_create(
            code="SITE-GY",
            defaults={
                "name": "固越企業總部工地",
                "location_type": LocationType.SITE,
                "project": project,
            },
        )

        phases = {}
        for seq, name in [(1, "第一期"), (2, "第二期"), (3, "第三期")]:
            phases[seq], _ = ProjectPhase.objects.update_or_create(
                project=project, seq=seq, defaults={"name": name},
            )

        # ★ 四筆里程碑刻意用上四種不同的觸發方式
        milestones = [
            (1, "簽約訂金", "簽約後支付", Decimal("30"), TriggerType.MANUAL, None, None, None),
            (2, "第一期請款", "第一期構件全數運抵工地並經業主簽收", Decimal("30"),
             TriggerType.ALL_SIGNED, None, phases[1], site),
            (3, "第二期請款", "第二期交付達 80% 後", Decimal("30"),
             TriggerType.WEIGHT_THRESHOLD, Decimal("80"), phases[2], site),
            (4, "完工尾款", "會同驗收完工", Decimal("10"), TriggerType.MANUAL, None, None, None),
        ]
        for seq, label, desc, pct, trigger, threshold, phase, loc in milestones:
            m, _ = BillingMilestone.objects.update_or_create(
                project=project, seq=seq,
                defaults={
                    "label": label, "trigger_desc": desc, "percentage": pct,
                    "trigger_type": trigger, "threshold_pct": threshold,
                    "phase": phase, "target_location": loc,
                },
            )
            m.recalc_amount()

        # 構件批次
        plant = User.objects.get(username="plant")
        worker = User.objects.get(username="worker")
        transport = Vendor.objects.get(code="V003")
        outsourcer = Vendor.objects.get(code="V002")

        batches = [
            # 名稱, 期別, 總數, 完成, 單位, 階段code, 負責人, 重量kg, 作業方式, 備註
            ("第一期-1F鋼柱", 1, 80, 80, "支", "deliver", worker, 31680, WorkMode.SELF, "已運抵工地，待業主簽收"),
            ("第一期-樓板鋼樑", 1, 120, 120, "支", "signoff", worker, 26280, WorkMode.SELF, "已進場待簽收"),
            ("第一期-樓梯鋼構", 1, 30, 30, "組", "staging", worker, 8400, WorkMode.SELF, "加工完成，置料區待運"),
            ("第一期-桁架A區", 1, 12, 6, "組", "fab", worker, 9600, WorkMode.SELF, "廠內加工中"),
            ("第二期-2F鋼柱", 2, 64, 20, "支", "fab", worker, 25344, WorkMode.SELF, "廠內二次加工線"),
            ("第二期-樓板鋼樑", 2, 90, 0, "支", "receive", worker, 19710, WorkMode.SELF, "等鋼材到料"),
        ]
        for name, phase_seq, total, done, uom, stage_code, assignee, weight, mode, note in batches:
            unit, _ = TrackingUnit.objects.update_or_create(
                project=project, name=name,
                defaults={
                    "phase": phases[phase_seq], "unit_type": UnitType.BATCH,
                    "template": steel_tpl,
                    "current_stage": steel_tpl.stages.get(code=stage_code),
                    "qty_total": Decimal(total), "qty_done": Decimal(done),
                    "unit_of_measure": uom, "total_weight_kg": Decimal(weight),
                    "assignee": assignee, "work_mode": mode,
                    "transport_vendor": transport if stage_code in ("deliver", "signoff") else None,
                    "note": note,
                },
            )

        # 一批送外包噴砂的，示範「料在協力廠」
        TrackingUnit.objects.update_or_create(
            project=project, name="第二期-樓梯鋼構",
            defaults={
                "phase": phases[2], "unit_type": UnitType.BATCH, "template": steel_tpl,
                "current_stage": steel_tpl.stages.get(code="surface"),
                "qty_total": Decimal("24"), "qty_done": Decimal("24"), "unit_of_measure": "組",
                "total_weight_kg": Decimal("6720"), "assignee": plant,
                "work_mode": WorkMode.OUTSOURCE, "outsource_vendor": outsourcer,
                "outsource_in_date": date(2026, 6, 5),
                "outsource_due_date": date(2026, 6, 20),
                "note": "送全興噴砂廠做噴砂＋噴漆",
            },
        )

        self.stdout.write(f"    專案 {project.code}　合約 {project.contract_amount:,.0f} 元")
        self.stdout.write("    3 個期別、4 筆請款里程碑（涵蓋 4 種觸發方式）、7 批構件")

    def _seed_other_projects(self):
        self.stdout.write("\n▸ 其他兩案")
        main_tpl = StageTemplate.default_for(TemplateAppliesTo.PROJECT_MAIN)
        steel_tpl = StageTemplate.default_for(TemplateAppliesTo.STEEL_BATCH)
        civil_tpl = StageTemplate.default_for(TemplateAppliesTo.CIVIL_WORK_ITEM)
        pm = User.objects.get(username="pm")
        site_mgr = User.objects.get(username="site")

        changhua, _ = Project.objects.update_or_create(
            code="P-2026-002",
            defaults={
                "name": "彰化食品廠房擴建", "project_type": ProjectType.MIXED,
                "customer": Customer.objects.get(code="C002"),
                "contract_amount": Decimal("32000000"), "owner": pm,
                "start_date": date(2026, 2, 15), "due_date": date(2026, 7, 20),
                "main_template": main_tpl, "main_stage": main_tpl.stages.get(code="purchase"),
                "status": Status.ATRISK, "note": "鋼柱進料驗收中，需追料",
            },
        )
        TrackingUnit.objects.update_or_create(
            project=changhua, name="第一期-H型鋼柱",
            defaults={
                "unit_type": UnitType.BATCH, "template": steel_tpl,
                "current_stage": steel_tpl.stages.get(code="receive"),
                "qty_total": Decimal("32"), "qty_done": Decimal("0"), "unit_of_measure": "支",
                "total_weight_kg": Decimal("12672"), "assignee": User.objects.get(username="plant"),
                "status": Status.ATRISK, "note": "等鋼材到料",
            },
        )
        # 土建工項：示範另一種追蹤單元
        TrackingUnit.objects.update_or_create(
            project=changhua, name="B1 結構體",
            defaults={
                "unit_type": UnitType.WORK_ITEM, "template": civil_tpl,
                "current_stage": civil_tpl.stages.get(code="construct"),
                "progress_pct": Decimal("65"), "assignee": site_mgr,
                "subcontractor": Vendor.objects.get(code="V005"),
                "subcontract_amount": Decimal("4200000"),
                "note": "分包永固土木，進度正常",
            },
        )

        nantou, _ = Project.objects.update_or_create(
            code="P-2026-003",
            defaults={
                "name": "南投國道橋樑鋼構", "project_type": ProjectType.STEEL,
                "customer": Customer.objects.get(code="C003"),
                "contract_amount": Decimal("56000000"), "owner": pm,
                "start_date": date(2025, 11, 1), "due_date": date(2026, 9, 15),
                "main_template": main_tpl, "main_stage": main_tpl.stages.get(code="build"),
                "status": Status.ONTRACK, "note": "桁架陸續出貨進場",
            },
        )
        # 這一案示範「每批按量分批請」
        m, _ = BillingMilestone.objects.update_or_create(
            project=nantou, seq=1,
            defaults={
                "label": "分批交付計價", "trigger_desc": "按實際交付噸數分批計價",
                "percentage": Decimal("90"), "trigger_type": TriggerType.PER_BATCH,
            },
        )
        m.recalc_amount()
        for name, total, done, stage, weight in [
            ("桁架 A 區", 12, 12, "deliver", 42000),
            ("桁架 B 區", 8, 5, "qc", 28000),
        ]:
            TrackingUnit.objects.update_or_create(
                project=nantou, name=name,
                defaults={
                    "unit_type": UnitType.BATCH, "template": steel_tpl,
                    "current_stage": steel_tpl.stages.get(code=stage),
                    "qty_total": Decimal(total), "qty_done": Decimal(done),
                    "unit_of_measure": "組", "total_weight_kg": Decimal(weight),
                    "assignee": User.objects.get(username="plant"),
                    "transport_vendor": Vendor.objects.get(code="V004"),
                },
            )
        self.stdout.write("    彰化案（含土建工項）、南投案（示範分批請款）")

    def _print_guide(self):
        self.stdout.write(self.style.MIGRATE_HEADING("\n可以怎麼玩"))
        self.stdout.write("""
  固越案的四筆里程碑用了四種觸發方式，這是理解系統的最快路徑：

  ① 簽約訂金 30%（手動）
     系統不管，會計自己開請款單

  ② 第一期請款 30%（該期全部簽收）★推薦先玩這個
     第一期有 4 批構件。全部簽收才會轉「可請款」。
     目前「樓板鋼樑」已在「進場簽收」站等著——
     試著登錄簽收，看系統回你「尚有 3 批未簽收」

  ③ 第二期請款 30%（累計重量達 80%）
     第二期共 3 批、51,774 kg。簽收累計噸數達 80% 才觸發

  ④ 完工尾款 10%（手動）

  南投案示範第四種：每批簽收就按噸數佔比產生一筆可請款

  操作步驟見 docs/11_系統操作說明.md
""")
