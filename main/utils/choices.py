"""
跨模組共用的列舉值

一律用 CharField + TextChoices，不用整數列舉——可讀性優先，
直接看資料庫也知道 'claimable' 是什麼意思。
"""
from django.db import models


class Status(models.TextChoices):
    """狀態燈號。專案與追蹤單元共用。"""

    ONTRACK = "ontrack", "正常"
    ATRISK = "atrisk", "注意"
    DELAYED = "delayed", "延誤"


# 顏色與燈號一律成對出現，且永遠伴隨文字標籤——顏色不單獨傳達意義
STATUS_COLORS = {
    Status.ONTRACK: "#059669",
    Status.ATRISK: "#d97706",
    Status.DELAYED: "#b91c1c",
}


class ProjectType(models.TextChoices):
    CIVIL = "civil", "土建"
    STEEL = "steel", "鋼構"
    MIXED = "mixed", "混合"


class ProjectLifecycle(models.TextChoices):
    """專案生命週期（2026-08-14 流程制改版）。

    與 Status（健康燈號）正交：一個案子可以「進行中」且「延誤」。
    「未成交」保留最小欄位——報價沒成的案子不該在系統裡當死案。
    """

    ACTIVE = "active", "進行中"
    LOST = "lost", "未成交"
    PAUSED = "paused", "暫停"
    CLOSED = "closed", "已結案"


class FlowState(models.TextChoices):
    """流程單元狀態。負責人回報完成即完成，不做二次覆核（2026-08-14 確認）。"""

    TODO = "todo", "未開始"
    DOING = "doing", "進行中"
    DONE = "done", "已完成"
    NA = "na", "不適用"


class UnitType(models.TextChoices):
    """追蹤單元類型。同一張表靠這個欄位分流。"""

    BATCH = "batch", "構件批次"          # 鋼構：完成數量／總數量
    WORK_ITEM = "work_item", "土建工項"  # 土建：完成百分比


class StageDirection(models.TextChoices):
    CREATE = "create", "建立"
    FORWARD = "forward", "推進"
    BACKWARD = "backward", "回退"


class MilestoneState(models.TextChoices):
    """應收款狀態。合約分期＝應收款，一列走完整個生命週期。"""

    PENDING = "pending", "未到"
    CLAIMABLE = "claimable", "可請款"
    INVOICED = "invoiced", "已請款"
    RECEIVED = "received", "已收款"


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


class AttachmentCategory(models.TextChoices):
    """附件分類。分類的用途是「找得到」，不是「分得細」。"""

    CONTRACT = "contract", "合約"
    DRAWING = "drawing", "圖說"
    SCHEDULE = "schedule", "時程表"
    PHOTO = "photo", "現場照片"
    INSPECTION = "inspection", "檢驗報告"
    SIGNOFF = "signoff", "簽收單"
    INVOICE = "invoice", "發票／請款單"
    OTHER = "other", "其他"


# ── 應付與現金流 ─────────────────────────────────────────────────
class SubcontractCategory(models.TextChoices):
    """分包合約類別。範圍限定在工程支出，不含薪資租金水電。"""

    SUBCONTRACT = "subcontract", "分包工程"
    MATERIAL = "material", "材料採購"
    OUTSOURCE = "outsource", "外包加工"
    TRANSPORT = "transport", "運輸"


class PaymentTermType(models.TextChoices):
    """付款條件的起算基準。

    ⚠️ 三者算出來的日期差很多，不能混用：
      · 月結 60 天 → 當月**月底**再加 60 天。1/15 請款是 4/1 付，不是 3/16
      · 請款日起算 60 天 → 1/15 請款就是 3/15
    這兩個差兩週，而且錯的方向是「以為錢比較早進來」。
    """

    MONTH_END = "month_end", "月結"
    FROM_INVOICE = "from_invoice", "請款日起算"
    FROM_ACCEPTANCE = "from_acceptance", "驗收後起算"


class PaymentMethod(models.TextChoices):
    """付款方式。

    ⚠️ 支票是台灣營造業的常態，而**開票日 ≠ 兌現日**——
    中間可能還有 60–90 天。不分開算，現金流會早算兩三個月。
    """

    TRANSFER = "transfer", "匯款"
    CHECK = "check", "支票"
    CASH = "cash", "現金"


class PayableState(models.TextChoices):
    """應付款項狀態。刻意跟應收（MilestoneState 後三態）對稱——

    會計學會一邊就等於學會另一邊：往前推、往回轉要填原因、留不可竄改歷程。
    """

    PENDING = "pending", "待計價"
    APPROVED = "approved", "已核可"
    PAID = "paid", "已付款"


class SubcontractStatus(models.TextChoices):
    ACTIVE = "active", "進行中"
    COMPLETED = "completed", "已完工"
    CLOSED = "closed", "已結案"


class Certainty(models.TextChoices):
    """現金流的確定性分級。

    混在一起會得到一個看起來精確、實際上騙人的數字。
    畫面上可以只看「確定」——那是最壞情況下的現金流。
    """

    CONFIRMED = "confirmed", "確定"
    LIKELY = "likely", "很可能"
    ESTIMATED = "estimated", "預估"


class MoneyDirection(models.TextChoices):
    """一筆錢的方向（D55）——行政事項的收支與「收支明細」共用。

    案子的錢方向是推出來的（應收＝收、應付＝付）；
    行政事項沒有這層結構，所以自己記一個方向。
    """

    IN = "in", "收入"
    OUT = "out", "支出"


class NotificationCategory(models.TextChoices):
    BILLING = "billing", "請款"
    TRACKING = "tracking", "進度"
    ALERT = "alert", "警示"
    AFFAIR = "affair", "行政"
    SYSTEM = "system", "系統"


class AffairFreq(models.TextChoices):
    """行政例行事項的重複頻率（D53）"""

    WEEKLY = "weekly", "每週"
    MONTHLY = "monthly", "每月"
    YEARLY = "yearly", "每年"


class ActivityCategory(models.TextChoices):
    PROJECT = "project", "專案"
    TRACKING = "tracking", "進度"
    BILLING = "billing", "請款"
    SYSTEM = "system", "系統"


class TemplateAppliesTo(models.TextChoices):
    PROJECT_MAIN = "project_main", "專案主線"
    STEEL_BATCH = "steel_batch", "鋼構構件批次"
    CIVIL_WORK_ITEM = "civil_work_item", "土建工項"


class PayrollStatus(models.TextChoices):
    """薪資期間的狀態（D57）。

    確認後鎖定——薪資是錢的歷程，算完給出去就不該再被無聲改掉。
    要改必須退回草稿，退回這件事本身會留紀錄。
    """

    DRAFT = "draft", "草稿"
    CONFIRMED = "confirmed", "已確認"
    PAID = "paid", "已發放"


class PayrollLineKind(models.TextChoices):
    """薪資單上手動加的一列（D57）。

    法規算得出來的（工資、加班、勞健保、福利金）由系統產生，不進這張表；
    這裡放的是規則以外的錢：獎金、津貼、補發、借支、代扣。
    """

    EARNING = "earning", "加項"
    DEDUCTION = "deduction", "扣項"
