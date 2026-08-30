"""
主檔種子：流程目錄（五大階段×19 工作項）＋構件批次七站＋專案主線

冪等——重跑不會產生重複資料，已存在就更新。
內容照抄 docs/鋼構專案流程.md v1.0（2026-08-14 流程制改版）。
要改流程直接在 Django Admin 改，順序（seq）改了就是全公司一起改。
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from main.apps.masters.models import FlowItem, FlowStage, Stage, StageTemplate
from main.utils.choices import TemplateAppliesTo

# ── 流程目錄：五大階段 ─────────────────────────────────────────────
# (seq, code, name, gate)
FLOW_STAGES = [
    (1, "s1", "需求釐清與估價", "報價依據圖定版"),
    (2, "s2", "報價協商與簽約", "合約簽訂"),
    (3, "s3", "深化設計與備料", "確認圖簽認＋主料下訂"),
    (4, "s4", "加工與現場施工", "完工（全部批次安裝完成）"),
    (5, "s5", "驗收與收款結案", "尾款收齊＋結案檢討完成"),
]

# (seq, code, name, description, deliverables, done_criteria, is_gate, batch_stage_seq)
FLOW_ITEMS = [
    (11, "1.1", "需求訪談與現場勘查",
     "與業主初談（用途、範圍、預算概念、時程期望），現場勘查與拍照。",
     "需求紀錄表、現場照片", "需求紀錄經內部確認，可安排丈量", False, None),
    (12, "1.2", "估價放樣收點",
     "現場丈量取得尺寸與點位，精度以「足以繪圖報價」為準。",
     "丈量／收點紀錄", "尺寸足以繪製估價圖", False, None),
    (13, "1.3", "估價繪圖與收斂",
     "繪製估價圖，與業主往返修改（迭代以版本號記錄 vE1、vE2⋯），計算數量。",
     "估價圖 vEx、數量計算表", "業主確認圖面可據以報價（報價依據圖定版）", False, None),

    (21, "2.1", "編制報價單與工期",
     "依報價依據圖與數量表，編列材料明細與單價、工資、機具、利潤；排定工期。",
     "報價單、甘特圖", "報價單送出予業主", False, None),
    (22, "2.2", "協商議價與合作模式界定",
     "與業主議價；界定供料方（主料／輔料各由誰供）與工項範圍。",
     "議價紀錄、供料與工項範圍界定表", "雙方就價格與範圍達成一致", False, None),
    (23, "2.3", "簽訂合約",
     "擬約／審約，載明付款期別與觸發里程碑（寫入應收期別）。",
     "合約書、付款期別條件", "雙方用印", False, None),

    (31, "3.1", "施工放樣收點",
     "簽約後赴現場精確放樣、收點，確認基準線與水平，供施工圖與預埋定位使用。",
     "施工放樣紀錄、基準點資料", "精度足以繪製加工圖", False, None),
    (32, "3.2", "施工圖／加工圖繪製",
     "繪製施工圖與加工詳圖（Tekla 建模），產出構件清單。",
     "施工圖、加工圖、構件清單、NC1/DSTV 檔", "圖面內部審核通過", False, None),
    (33, "3.3", "業主圖面簽認",
     "送業主簽認。未取得簽認不得下料加工——此為爭議時的法律防線。",
     "簽認確認圖", "簽認圖簽回", True, None),
    (34, "3.4", "訂料與採購",
     "依構件清單開料單；每項料以「主料／輔料 × 業主供／我方採購」四象限管理；"
     "追蹤交期與進料驗收。長交期料得於簽約後先行下訂。",
     "料單、採購單／叫料單、進料驗收紀錄", "主料到位，可排入生產", False, None),

    (41, "4.1", "廠內加工",
     "下料、切割（TLS 雷射／CNC）、組立、焊接、廠內檢驗。",
     "各批次加工進度回報、檢驗紀錄", "批次加工完成", False, 3),
    (42, "4.2", "表面處理",
     "熱浸鍍鋅／烤漆／噴漆（自辦或委外），追蹤送出與回廠。",
     "表處完成紀錄", "批次表處完成", False, 5),
    (43, "4.3", "出貨運輸",
     "排車、吊車、路線與交管協調。",
     "出貨單", "批次到場點交", False, 6),
    (44, "4.4", "基礎預埋",
     "依簽認圖製作預埋件／錨定螺栓與模板，配合土建灌漿時程到場定位安裝。"
     "通常為最早的現場工作，常於加工完成前施作——允許提前完成。",
     "預埋圖、預埋完成紀錄與照片", "預埋完成且複測合格", False, None),
    (45, "4.5", "現場吊裝安裝",
     "各批次吊裝、鎖固、焊接、校正，每日回報。（視業主要求：勞安文件、吊裝計畫。）",
     "施工日報、各批次安裝完成照片", "全部批次安裝完成", False, 7),

    (51, "5.1", "完工自主檢查與初驗",
     "完工後自主檢查，知會業主辦理初驗。",
     "自主檢查表、初驗紀錄", "初驗完成", False, None),
    (52, "5.2", "缺失改善與複驗",
     "缺失逐項列管、改善、複驗，至通過為止。",
     "缺失清單、改善紀錄、驗收單", "業主驗收通過", False, None),
    (53, "5.3", "尾款請款與收款",
     "依合約請領尾款。",
     "請款單、收款紀錄", "尾款入帳", False, None),
    (54, "5.4", "結案檢討",
     "實際成本 vs 報價逐項比對，檢討差異原因，回饋估價單價資料；專案文件歸檔。",
     "成本差異分析表、結案歸檔清單", "檢討會議完成", False, None),
]

# ── 階段模板（構件批次子管線＋專案主線）───────────────────────────
TEMPLATES = [
    {
        "code": "main",
        "name": "專案主線",
        "applies_to": TemplateAppliesTo.PROJECT_MAIN,
        "stages": [
            ("prep", "準備中", "#6366f1", None),
            ("build", "施工中", "#f59e0b", None),
            ("verify", "驗收中", "#10b981", 30),
            ("closed", "結案", "#64748b", None),
        ],
    },
    {
        # 批次七站（docs/鋼構專案流程.md 第 5 節）。
        # FlowItem.batch_stage_seq 指著這裡的 seq：4.1→3、4.2→5、4.3→6、4.5→7
        "code": "steel",
        "name": "構件批次",
        "applies_to": TemplateAppliesTo.STEEL_BATCH,
        "stages": [
            ("wait", "待加工", "#94a3b8", 14),
            ("fabbing", "加工中", "#86b6ef", 21),
            ("fabbed", "加工完成", "#6366f1", 14),
            ("surfacing", "表處中", "#d97706", 21),
            ("ready", "待出貨", "#0ea5e9", 14),
            ("shipped", "已出貨", "#38bdf8", 14),
            ("installed", "已安裝", "#10b981", None),
        ],
    },
]


class Command(BaseCommand):
    help = "建立流程目錄與階段模板主檔（冪等）"

    @transaction.atomic
    def handle(self, *args, **options):
        from main.apps.masters.models import FlowTemplate

        # 流程目錄（D49：19 項掛在「標準流程」預設模板底下）
        default_tpl, _ = FlowTemplate.objects.get_or_create(
            name="標準流程", defaults={"is_default": True, "is_active": True},
        )
        stage_by_seq = {}
        for seq, code, name, gate in FLOW_STAGES:
            stage, _ = FlowStage.objects.update_or_create(
                code=code, defaults={"seq": seq, "name": name, "gate": gate, "is_active": True},
            )
            stage_by_seq[seq] = stage
        for seq, code, name, desc, deliver, done, is_gate, batch_seq in FLOW_ITEMS:
            FlowItem.objects.update_or_create(
                code=code, template=default_tpl,
                defaults={
                    "stage": stage_by_seq[seq // 10], "seq": seq, "name": name,
                    "description": desc, "deliverables": deliver, "done_criteria": done,
                    "is_gate": is_gate, "batch_stage_seq": batch_seq, "is_active": True,
                },
            )
        self.stdout.write(f"  流程目錄：{len(FLOW_STAGES)} 大階段、{len(FLOW_ITEMS)} 工作項")

        # 階段模板
        for spec in TEMPLATES:
            template, created = StageTemplate.objects.update_or_create(
                code=spec["code"],
                defaults={
                    "name": spec["name"],
                    "applies_to": spec["applies_to"],
                    "is_default": True,
                    "is_active": True,
                },
            )
            # 先把不在名單裡的舊站停用並挪到 seq 100+——
            # 新站要用的 seq 可能被舊站占著，(template, seq) 有唯一約束
            keep = [c for c, *_ in spec["stages"]]
            for i, old in enumerate(template.stages.exclude(code__in=keep)):
                old.seq = 100 + i
                old.is_active = False
                old.save(update_fields=["seq", "is_active"])
            for seq, (code, name, color, stall) in enumerate(spec["stages"], start=1):
                Stage.objects.update_or_create(
                    template=template, code=code,
                    defaults={
                        "seq": seq, "name": name, "color": color,
                        "stall_days": stall, "is_active": True,
                    },
                )

            state = "建立" if created else "更新"
            self.stdout.write(f"  {state} {template.name}（{len(spec['stages'])} 站）")

        # 土建工項模板走入歷史——土建案＝勾比較少的流程，不再是另一條模板
        StageTemplate.objects.filter(code="civil").update(is_default=False, is_active=False)

        self.stdout.write(self.style.SUCCESS("主檔種子完成"))
