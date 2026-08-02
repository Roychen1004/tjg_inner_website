"""
庫存異動

**唯一原則：庫存數量只能透過異動紀錄改變。**

直接 UPDATE lot.qty_on_hand 是最容易做、也最容易在半年後
變成「帳面 300 支、實際 180 支，沒人知道那 120 支去哪」的做法。
所有進出都在這裡，都留下不可竄改的 StockTransaction。
"""
import logging

from django.db import transaction
from django.utils import timezone

from main.apps.core.models import ActivityLog
from main.apps.inventory.models import Lot, StockTransaction
from main.utils.choices import ActivityCategory, LotStatus, StockTxnType
from main.utils.exceptions import BusinessRuleError

logger = logging.getLogger("tjg")


@transaction.atomic
def receive(
    *,
    item,
    location,
    qty,
    operator,
    lot_no="",
    unit_cost=None,
    mill_cert_no="",
    heat_no="",
    source_po_no="",
    reserved_for_project=None,
    received_date=None,
    note="",
):
    """入庫。

    P1 用於**期初盤點建檔**（把倉庫現有的料一次建進系統）與零星補料。
    P2 導入採購模組後，收料會由採購單自動帶出來，不用手打。
    """
    if qty is None or qty <= 0:
        raise BusinessRuleError("入庫數量必須大於 0")
    if item.requires_mill_cert and not mill_cert_no:
        raise BusinessRuleError(
            f"「{item.name}」需要材質證明。沒有材證的鋼材日後查不出爐號，"
            "業主查驗時會出問題"
        )

    lot = Lot.objects.create(
        lot_no=lot_no or _next_lot_no(item),
        item=item,
        location=location,
        qty_on_hand=qty,
        unit_cost=unit_cost,
        total_value=(unit_cost * qty) if unit_cost else None,
        status=LotStatus.AVAILABLE,
        reserved_for_project=reserved_for_project,
        received_date=received_date or timezone.localdate(),
        last_move_date=received_date or timezone.localdate(),
        mill_cert_no=mill_cert_no,
        heat_no=heat_no,
        source_po_no=source_po_no,
        note=note,
    )
    lot.aging_status = lot.compute_aging_status()
    lot.save(update_fields=["aging_status"])

    StockTransaction.objects.create(
        lot=lot,
        txn_type=StockTxnType.RECEIPT,
        qty=qty,
        qty_before=0,
        qty_after=qty,
        to_location=location,
        project=reserved_for_project,
        unit_cost=unit_cost,
        amount=(unit_cost * qty) if unit_cost else None,
        operator=operator,
        note=note or "入庫建檔",
    )
    ActivityLog.record(
        f"{item.name} 入庫 {qty:g} {item.unit_of_measure}（{location.name}）",
        ActivityCategory.ASSET, actor=operator, project=reserved_for_project, obj=lot,
    )
    logger.info("入庫 %s：%s %s", lot.lot_no, item.code, qty)
    return lot


@transaction.atomic
def adjust(*, lot, new_qty, operator, note=""):
    """盤盈虧調整。

    調整**必須填原因**——帳實不符是管理問題，
    讓人隨手改數字而不用交代，等於承認帳沒在管。
    """
    if new_qty is None or new_qty < 0:
        raise BusinessRuleError("盤點數量不可為負")
    if not note:
        raise BusinessRuleError("盤點調整必須填寫原因")

    lot = Lot.objects.select_for_update(of=("self",)).get(pk=lot.pk)
    before = lot.qty_on_hand
    if new_qty == before:
        raise BusinessRuleError("數量沒有變化")

    lot.qty_on_hand = new_qty
    lot.last_move_date = timezone.localdate()
    if lot.unit_cost:
        lot.total_value = lot.unit_cost * new_qty
    lot.aging_status = lot.compute_aging_status()
    lot.save(update_fields=["qty_on_hand", "last_move_date", "total_value", "aging_status", "updated_at"])

    StockTransaction.objects.create(
        lot=lot, txn_type=StockTxnType.ADJUST,
        qty=new_qty - before, qty_before=before, qty_after=new_qty,
        from_location=lot.location, to_location=lot.location,
        operator=operator, note=note,
    )
    diff = new_qty - before
    ActivityLog.record(
        f"{lot.item.name}（{lot.lot_no}）盤點調整 {diff:+g}：{note}",
        ActivityCategory.ASSET, actor=operator, obj=lot,
    )
    return lot


@transaction.atomic
def issue(*, lot, qty, operator, project=None, tracking_unit=None, note=""):
    """領用出庫。

    帶 tracking_unit 時，材料成本就自動歸到那一批構件上——
    這是 P2「專案實際成本」能算得出來的關鍵。
    """
    if qty is None or qty <= 0:
        raise BusinessRuleError("領用數量必須大於 0")

    lot = Lot.objects.select_for_update(of=("self",)).get(pk=lot.pk)
    if qty > lot.qty_available:
        raise BusinessRuleError(
            f"可用量只有 {lot.qty_available:g}（現有 {lot.qty_on_hand:g}、"
            f"已預留 {lot.qty_reserved:g}）"
        )

    before = lot.qty_on_hand
    lot.qty_on_hand = before - qty
    lot.last_move_date = timezone.localdate()
    if lot.unit_cost:
        lot.total_value = lot.unit_cost * lot.qty_on_hand
    if lot.qty_on_hand == 0:
        lot.status = LotStatus.ISSUED
    lot.save(update_fields=[
        "qty_on_hand", "last_move_date", "total_value", "status", "updated_at",
    ])

    StockTransaction.objects.create(
        lot=lot, txn_type=StockTxnType.ISSUE,
        qty=-qty, qty_before=before, qty_after=lot.qty_on_hand,
        from_location=lot.location,
        project=project, tracking_unit=tracking_unit,
        unit_cost=lot.unit_cost,
        amount=(lot.unit_cost * qty) if lot.unit_cost else None,
        operator=operator, note=note,
    )
    target = tracking_unit.name if tracking_unit else (project.name if project else "")
    ActivityLog.record(
        f"{lot.item.name} 領用 {qty:g} {lot.item.unit_of_measure}" + (f" → {target}" if target else ""),
        ActivityCategory.ASSET, actor=operator, project=project, obj=lot,
    )
    return lot


def _next_lot_no(item):
    """批號：料號-YYYYMM-序號"""
    stamp = timezone.localdate().strftime("%Y%m")
    prefix = f"{item.code}-{stamp}-"
    last = Lot.objects.filter(lot_no__startswith=prefix).order_by("-lot_no").first()
    seq = int(last.lot_no.rsplit("-", 1)[1]) + 1 if last else 1
    return f"{prefix}{seq:03d}"
