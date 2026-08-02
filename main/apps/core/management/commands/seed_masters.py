"""
載入主檔種子資料：階段模板、角色群組、系統參數

冪等 —— 可重複執行，不會產生重複資料。
"""
from datetime import date

from django.contrib.auth.models import Group
from django.core.management.base import BaseCommand
from django.db import transaction

from main.apps.core.models import Role, SystemParameter
from main.apps.masters.models import Stage, StageTemplate
from main.utils.choices import TemplateAppliesTo

# ── 階段模板 ───────────────────────────────────────────────────────
# 欄位：seq, code, name, color, 旗標dict, stall_days
STAGE_TEMPLATES = [
    {
        "code": "project_main",
        "name": "專案主線",
        "applies_to": TemplateAppliesTo.PROJECT_MAIN,
        "stages": [
            (1, "lead", "接案", "#6366f1", {}, None),
            (2, "design", "深化設計", "#3b82f6", {}, 30),
            (3, "quote", "報價", "#0ea5e9", {}, 14),
            (4, "purchase", "採購備料", "#14b8a6", {}, None),
            (5, "build", "施工中", "#f59e0b", {}, None),
            (6, "verify", "完工驗收", "#10b981", {}, None),
            (7, "close", "結案", "#64748b", {}, None),
        ],
    },
    {
        # 2026-08-02 決議：新增第 7 站「進場簽收」，請款改為登錄簽收後觸發
        "code": "steel_batch",
        "name": "鋼構構件批次",
        "applies_to": TemplateAppliesTo.STEEL_BATCH,
        "stages": [
            (1, "receive", "進料驗收", "#86b6ef", {}, 7),
            (2, "fab", "加工", "#86b6ef", {"is_core": True}, None),
            (3, "qc", "品檢", "#86b6ef", {}, 3),
            (4, "staging", "置料區", "#2a78d6", {"is_hold": True}, 14),
            (5, "surface", "表面處理", "#2a78d6", {"is_outsource": True, "is_core": True}, None),
            (6, "deliver", "出貨進場", "#104281", {}, 3),
            (7, "signoff", "進場簽收", "#104281",
             {"requires_signoff": True, "is_billing_trigger": True}, 7),
            (8, "install", "安裝", "#104281", {}, None),
            (9, "finish", "收尾", "#104281", {}, 14),
        ],
    },
    {
        "code": "civil_work_item",
        "name": "土建工項",
        "applies_to": TemplateAppliesTo.CIVIL_WORK_ITEM,
        "stages": [
            (1, "layout", "放樣定位", "#86b6ef", {}, None),
            (2, "construct", "施工中", "#86b6ef", {"is_core": True}, None),
            (3, "selfcheck", "自主檢查", "#2a78d6", {}, 7),
            (4, "inspect", "監造查驗", "#2a78d6", {}, 14),
            # 土建：監造查驗通過即可計價，不需另簽簽收單
            (5, "done", "完成", "#104281", {"is_billing_trigger": True}, None),
        ],
    },
]

# ── 系統參數（依手冊附錄 B 與各章數值）────────────────────────────
PARAMETERS = [
    ("salary_annual_multiplier", "年薪倍數（含年終）", "13.5", "倍", "手冊附錄B二"),
    ("effective_hours_per_year", "年有效工時", "1600", "小時", "手冊附錄B二：扣除休假、教育訓練、會議"),
    ("fringe_rate_default", "人事附加率（預設）", "0.22", "比率", "手冊附錄B二：範圍 0.18–0.28"),
    ("fringe_rate_direct", "直接人工附加率", "0.20", "比率", "手冊 10.3"),
    ("fringe_rate_indirect", "間接人力附加率", "0.28", "比率", "手冊 7.3"),
    ("overhead_rate", "製造費用率", "1072.00", "元/工時",
     "手冊 13.3。⚠️ 每年必須重算（13.5 三大陷阱之二）"),
    ("overhead_pool_annual", "年度製造費用池", "34310000", "元", "手冊 13.3"),
    ("direct_labor_hours_annual", "年度直接人工工時", "32000", "小時", "手冊 13.3：20 人 × 1600h"),
    ("capital_cost_rate", "資金成本率", "0.035", "比率/年", "手冊 8.3：庫存資金占用計算"),
    ("equipment_idle_cost_hour", "設備閒置成本", "250.00", "元/小時", "手冊 9.3"),
    ("sga_rate", "管銷費用分攤率", "0.102", "比率", "手冊 13.4"),
    ("target_gross_margin", "目標毛利率", "0.25", "比率", "手冊 13.4"),
    ("material_loss_rate", "材料損耗率", "0.08", "比率", "手冊 13.4"),
    ("min_purchase_amount", "最低採購門檻", "75000.00", "元",
     "手冊 7.4：低於此金額時人力成本占比超過 5%，建議合併採購"),
    ("purchase_labor_hours", "單筆採購工時", "10.0", "小時", "手冊 7.3：單筆人力成本 = 10h × 378 = 3,780 元"),
    ("signoff_overdue_days", "待簽收逾時天數", "7", "天", "本系統：進場簽收停留超過此天數列入需關注"),
    ("claimable_overdue_days", "可請款逾時天數", "7", "天", "本系統"),
    ("receivable_overdue_days", "應收逾期天數", "60", "天", "本系統"),
    ("outsource_warn_days", "外包逾期警示天數", "1", "天", "本系統：轉「注意」"),
    ("outsource_alert_days", "外包逾期升級天數", "7", "天", "本系統：轉「延誤」並通知"),
    ("default_weight_threshold_pct", "預設累計重量門檻", "80.00", "%", "本系統：建立門檻型里程碑時的預設值"),
]


class Command(BaseCommand):
    help = "載入階段模板、角色群組與系統參數（冪等，可重複執行）"

    @transaction.atomic
    def handle(self, *args, **options):
        self.stdout.write(self.style.MIGRATE_HEADING("載入主檔種子資料"))
        self._seed_roles()
        self._seed_templates()
        self._seed_parameters()
        self.stdout.write(self.style.SUCCESS("\n✔ 主檔種子資料載入完成"))

    # ── 角色群組 ───────────────────────────────────────────────────
    def _seed_roles(self):
        self.stdout.write("\n▸ 角色群組")
        created = 0
        for code, label in Role.choices:
            _, is_new = Group.objects.get_or_create(name=code)
            created += int(is_new)
            self.stdout.write(f"    {'＋' if is_new else '·'} {code:<12} {label}")
        self.stdout.write(f"  共 {len(Role.choices)} 個角色（新增 {created}）")

    # ── 階段模板 ───────────────────────────────────────────────────
    def _seed_templates(self):
        self.stdout.write("\n▸ 階段模板")
        for spec in STAGE_TEMPLATES:
            template, is_new = StageTemplate.objects.update_or_create(
                code=spec["code"],
                defaults={
                    "name": spec["name"],
                    "applies_to": spec["applies_to"],
                    "is_default": True,
                    "is_active": True,
                },
            )
            self.stdout.write(
                f"    {'＋' if is_new else '·'} {template.name}（{len(spec['stages'])} 階段）"
            )
            for seq, code, name, color, flags, stall in spec["stages"]:
                stage, _ = Stage.objects.update_or_create(
                    template=template,
                    code=code,
                    defaults={
                        "seq": seq,
                        "name": name,
                        "color": color,
                        "stall_days": stall,
                        "is_active": True,
                        "is_billing_trigger": flags.get("is_billing_trigger", False),
                        "requires_signoff": flags.get("requires_signoff", False),
                        "is_outsource": flags.get("is_outsource", False),
                        "is_hold": flags.get("is_hold", False),
                        "is_core": flags.get("is_core", False),
                    },
                )
                marks = "".join([
                    "💰" if stage.is_billing_trigger else "",
                    "✍" if stage.requires_signoff else "",
                    "🚚" if stage.is_outsource else "",
                    "⏸" if stage.is_hold else "",
                    "⚙" if stage.is_core else "",
                ])
                stall_txt = f"　停滯>{stall}天" if stall else ""
                self.stdout.write(f"        {seq}. {name:<6}{marks}{stall_txt}")

    # ── 系統參數 ───────────────────────────────────────────────────
    def _seed_parameters(self):
        self.stdout.write("\n▸ 系統參數")
        effective_from = date(2026, 1, 1)
        created = 0
        for code, name, value, unit, note in PARAMETERS:
            _, is_new = SystemParameter.objects.update_or_create(
                code=code,
                effective_from=effective_from,
                defaults={"name": name, "value": value, "unit": unit, "source_note": note},
            )
            created += int(is_new)
        self.stdout.write(f"    共 {len(PARAMETERS)} 項（新增 {created}），生效日 {effective_from}")
