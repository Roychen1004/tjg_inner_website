"""
跨模組共用的列舉值

對應 `docs/鐵正綱ERP_資料庫設計.xlsx` → ⑥ 列舉值。
一律用 CharField + TextChoices，不用整數列舉——可讀性優先，
直接看資料庫也知道 'claimable' 是什麼意思。
"""
from django.db import models


class Status(models.TextChoices):
    """狀態燈號。專案與追蹤單元共用。"""

    ONTRACK = "ontrack", "正常"
    ATRISK = "atrisk", "注意"
    DELAYED = "delayed", "延誤"


# 顏色與燈號一律成對出現，且永遠伴隨文字標籤——
# 顏色不單獨傳達意義（見 docs/開發/04_UI設計原則.md §4.4）
STATUS_COLORS = {
    Status.ONTRACK: "#059669",
    Status.ATRISK: "#d97706",
    Status.DELAYED: "#b91c1c",
}


class ProjectType(models.TextChoices):
    CIVIL = "civil", "土建"
    STEEL = "steel", "鋼構"
    MIXED = "mixed", "混合"


class UnitType(models.TextChoices):
    """追蹤單元類型。同一張表靠這個欄位分流。"""

    BATCH = "batch", "構件批次"          # 鋼構：完成數量／總數量
    WORK_ITEM = "work_item", "土建工項"  # 土建：完成百分比


class WorkMode(models.TextChoices):
    SELF = "self", "鐵正綱自行"
    OUTSOURCE = "outsource", "外包協力廠"


class StageDirection(models.TextChoices):
    CREATE = "create", "建立"
    FORWARD = "forward", "推進"
    BACKWARD = "backward", "回退"


class RollbackReason(models.TextChoices):
    """回退原因。

    P1 就開始收集，到 P3 才有足夠歷史資料計算 PAF 品質成本模型
    （手冊 11.2）。前四項會歸入「內部失敗成本」。
    """

    QC_FAIL = "qc_fail", "品檢不合格"
    DIMENSION_ERROR = "dimension_error", "尺寸錯誤"
    MATERIAL_ISSUE = "material_issue", "材料問題"
    WORKMANSHIP = "workmanship", "施工缺失"
    OWNER_CHANGE = "owner_change", "業主變更"
    OTHER = "other", "其他"


#: 會歸入 PAF 內部失敗成本的原因（P3 用）
INTERNAL_FAILURE_REASONS = {
    RollbackReason.QC_FAIL,
    RollbackReason.DIMENSION_ERROR,
    RollbackReason.MATERIAL_ISSUE,
    RollbackReason.WORKMANSHIP,
}


class MilestoneState(models.TextChoices):
    """請款里程碑的彙總狀態（由三個累計金額推導）"""

    PENDING = "pending", "未到"
    CLAIMABLE = "claimable", "可請款"
    PARTIAL = "partial", "部分請款"
    INVOICED = "invoiced", "已請款"
    RECEIVED = "received", "已收款"


class ClaimState(models.TextChoices):
    """單筆請款事件的狀態"""

    CLAIMABLE = "claimable", "可請款"
    INVOICED = "invoiced", "已請款"
    RECEIVED = "received", "已收款"


class TriggerType(models.TextChoices):
    """請款觸發方式（依合約逐筆設定，見決策 D16）"""

    MANUAL = "manual", "手動"
    ALL_SIGNED = "all_signed", "該期全部簽收"
    WEIGHT_THRESHOLD = "weight_threshold", "累計重量達門檻"
    PER_BATCH = "per_batch", "每批按量分批請"


class ClaimSource(models.TextChoices):
    AUTO_SIGNOFF = "auto_signoff", "簽收自動產生"
    MANUAL = "manual", "人工建立"


class ChangeOrderStatus(models.TextChoices):
    DRAFT = "draft", "草稿"
    SUBMITTED = "submitted", "已送簽"
    APPROVED = "approved", "已核准"
    REJECTED = "rejected", "已駁回"


class VendorType(models.TextChoices):
    """廠商類型。同一家廠商可同時具備多種身分，故存成陣列。"""

    SUPPLIER = "supplier", "供應商"
    SUBCONTRACTOR = "subcontractor", "分包商"
    OUTSOURCE = "outsource", "外包加工"
    TRANSPORT = "transport", "運輸行"


class ItemKind(models.TextChoices):
    MATERIAL = "material", "建材"
    PART = "part", "零件耗材"
    TOOL = "tool", "工具"
    EQUIPMENT = "equipment", "設備"


class TrackingMode(models.TextChoices):
    """物品的追蹤方式。

    一支電焊機不會「用掉 0.3 支」，一張鋼板也不會「歸還」——
    兩者管理模型不同，但共用同一份物品主檔（見決策 D10）。
    """

    QUANTITY = "quantity", "數量型"      # 用批號管，問「還剩多少」
    INDIVIDUAL = "individual", "個體型"  # 有財產編號，問「在誰手上」


class ProfileType(models.TextChoices):
    """鋼構料型。決定表單顯示哪些尺寸欄位。"""

    PLATE = "plate", "鋼板"
    H_BEAM = "h_beam", "H型鋼"
    ANGLE = "angle", "角鋼"
    CHANNEL = "channel", "槽鋼"
    SQ_TUBE = "sq_tube", "方管"
    RD_TUBE = "rd_tube", "圓管"
    REBAR = "rebar", "鋼筋"
    BOLT = "bolt", "螺栓"
    OTHER = "other", "其他"


#: 各料型實際會用到的尺寸欄位。Admin 表單依此只顯示相關欄位，
#: 不讓使用者面對一堆填不到的空格。
PROFILE_DIMENSION_FIELDS = {
    ProfileType.PLATE: ["thickness_mm", "width_mm", "length_mm"],
    ProfileType.H_BEAM: ["height_mm", "width_mm", "web_thickness_mm", "flange_thickness_mm", "length_mm"],
    ProfileType.ANGLE: ["width_mm", "height_mm", "thickness_mm", "length_mm"],
    ProfileType.CHANNEL: ["height_mm", "width_mm", "thickness_mm", "length_mm"],
    ProfileType.SQ_TUBE: ["width_mm", "height_mm", "thickness_mm", "length_mm"],
    ProfileType.RD_TUBE: ["diameter_mm", "thickness_mm", "length_mm"],
    ProfileType.REBAR: ["diameter_mm", "length_mm"],
    ProfileType.BOLT: ["diameter_mm", "length_mm"],
    ProfileType.OTHER: [],
}


class SurfaceTreatment(models.TextChoices):
    RAW = "raw", "裸材"
    GALVANIZED = "galvanized", "鍍鋅"
    PRIMED = "primed", "防鏽底漆"


class LocationType(models.TextChoices):
    """位置類型。

    site 與 vendor 是關鍵——送外包的料在傳統系統裡「已出庫」等於消失，
    這裡它仍在帳上，只是位置在協力廠（見決策 D10）。
    """

    WAREHOUSE = "warehouse", "倉庫"
    RACK = "rack", "儲位"
    YARD = "yard", "置料區"
    SITE = "site", "工地"          # 需關聯專案
    VENDOR = "vendor", "外包廠"    # 需關聯廠商
    VEHICLE = "vehicle", "車輛"
    OFFICE = "office", "辦公室"
    SCRAP = "scrap", "廢料區"


class LotStatus(models.TextChoices):
    QUARANTINE = "quarantine", "待驗收"
    AVAILABLE = "available", "可用"
    RESERVED = "reserved", "已預留"
    ISSUED = "issued", "已領用"
    HOLD = "hold", "品質凍結"
    SCRAPPED = "scrapped", "已報廢"


class AgingStatus(models.TextChoices):
    """庫齡狀態。由 scan_alerts 每日更新（手冊 8.4）。"""

    NORMAL = "normal", "正常"                     # < 30 天
    SLOW = "slow", "緩動"                         # 30–90
    STAGNANT = "stagnant", "滯銷"                 # 90–180，計入呆滯料佔比 KPI
    DEAD = "dead", "呆滯"                         # 180–365
    SCRAP_CANDIDATE = "scrap_candidate", "報廢候選"  # > 365


#: 庫齡分級門檻（天）。key 為狀態，value 為「到達此天數即歸入該級」
AGING_THRESHOLDS = [
    (365, AgingStatus.SCRAP_CANDIDATE),
    (180, AgingStatus.DEAD),
    (90, AgingStatus.STAGNANT),
    (30, AgingStatus.SLOW),
    (0, AgingStatus.NORMAL),
]


class StockTxnType(models.TextChoices):
    RECEIPT = "receipt", "入庫"
    ISSUE = "issue", "領用"
    RETURN = "return", "退料"
    TRANSFER = "transfer", "移轉"
    ADJUST = "adjust", "盤盈虧"
    SCRAP = "scrap", "報廢"
    SPLIT = "split", "切割分批"


class AssetStatus(models.TextChoices):
    IDLE = "idle", "閒置可用"
    IN_USE = "in_use", "使用中"
    LENT = "lent", "借出"
    MAINTENANCE = "maintenance", "維修中"
    CALIBRATION = "calibration", "校驗中"
    SCRAPPED = "scrapped", "報廢"
    LOST = "lost", "遺失"


class AssetMovementType(models.TextChoices):
    ASSIGN = "assign", "派用"
    RETURN = "return", "歸還"
    TRANSFER = "transfer", "移轉"
    LEND = "lend", "借出"
    MAINTENANCE_IN = "maintenance_in", "送修"
    MAINTENANCE_OUT = "maintenance_out", "修畢"
    CALIBRATE = "calibrate", "校驗"
    SCRAP = "scrap", "報廢"
    LOST = "lost", "遺失"


class LineStatus(models.TextChoices):
    RUN = "run", "運轉中"
    CHANGEOVER = "changeover", "換線中"
    REPAIR = "repair", "維修"
    IDLE = "idle", "閒置"


class NotificationCategory(models.TextChoices):
    BILLING = "billing", "請款"
    TRACKING = "tracking", "進度"
    ALERT = "alert", "警示"
    ASSET = "asset", "資產"
    SYSTEM = "system", "系統"


class ActivityCategory(models.TextChoices):
    PROJECT = "project", "專案"
    TRACKING = "tracking", "進度"
    BILLING = "billing", "請款"
    LINE = "line", "產線"
    ASSET = "asset", "資產"
    SYSTEM = "system", "系統"


class TemplateAppliesTo(models.TextChoices):
    PROJECT_MAIN = "project_main", "專案主線"
    STEEL_BATCH = "steel_batch", "鋼構構件批次"
    CIVIL_WORK_ITEM = "civil_work_item", "土建工項"


class KpiStatus(models.TextChoices):
    GOOD = "good", "達標"
    WARN = "warn", "注意"
    BAD = "bad", "未達標"
    NODATA = "nodata", "無資料"  # 分母為 0；不等於「不好」
