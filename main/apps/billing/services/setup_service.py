"""
請款設定檢查

**存在的理由**：請款自動化要能跑，前置條件有五、六項，
任何一項沒做，結果都是「簽收了但什麼都沒發生」——
而畫面上看不出是哪裡沒做。

與其讓使用者自己推敲，不如逐項檢查後直接說：**你還缺這個，去哪裡補。**

每一項都要回答三件事：
  現在怎樣（status）· 為什麼重要（why）· 該去哪裡做（action ＋ link）
"""
from decimal import Decimal

from main.apps.billing.models import BillingMilestone
from main.apps.tracking.models import TrackingUnit
from main.utils.choices import TriggerType

OK = "ok"
WARN = "warn"
BLOCK = "block"


def check(project):
    """回傳這個專案的請款設定檢查結果"""
    milestones = list(
        BillingMilestone.objects.filter(project=project).select_related("phase")
    )
    phases = list(project.phases.all())
    units = list(project.units.select_related("phase"))

    items = [
        _check_milestones(project, milestones),
        _check_percentage(project, milestones),
        _check_phases(project, phases, milestones),
        _check_unit_phase(project, phases, units),
        _check_weight(project, milestones, units),
        _check_signoff_stage(project, milestones, units),
    ]
    items = [i for i in items if i is not None]

    blocking = [i for i in items if i["status"] == BLOCK]
    warning = [i for i in items if i["status"] == WARN]
    return {
        "ready": not blocking,
        "summary": (
            "請款自動化已就緒" if not blocking and not warning
            else f"還有 {len(blocking)} 項必須處理" if blocking
            else f"可以運作，但有 {len(warning)} 項建議確認"
        ),
        "blocking_count": len(blocking),
        "warning_count": len(warning),
        "items": items,
    }


def _check_milestones(project, milestones):
    """第一關：有沒有里程碑。沒有的話後面都不用談"""
    if not milestones:
        return {
            "key": "milestones",
            "title": "建立合約里程碑",
            "status": BLOCK,
            "detail": "這個案子還沒有任何請款里程碑",
            "why": "里程碑是合約寫的請款條件。沒有它，簽收再多批也不會有錢跑出來——系統不知道什麼情況算可以請款",
            "action": "到「合約里程碑」分頁新增，把合約上每一條抄進來",
            "link": f"/billing?project={project.pk}&tab=milestones",
        }
    return {
        "key": "milestones",
        "title": "建立合約里程碑",
        "status": OK,
        "detail": f"已建立 {len(milestones)} 筆：" + "、".join(m.label for m in milestones[:4]),
        "why": "",
        "action": "",
        "link": "",
    }


def _check_percentage(project, milestones):
    """比例加總。不是 100% 通常是漏了一條"""
    if not milestones:
        return None
    total = sum((m.percentage or Decimal("0")) for m in milestones)
    if total == 100:
        return {
            "key": "percentage",
            "title": "比例加總 100%",
            "status": OK,
            "detail": "各期比例合計 100%",
            "why": "", "action": "", "link": "",
        }
    return {
        "key": "percentage",
        "title": "比例加總 100%",
        "status": WARN,
        "detail": f"目前合計 {total:g}%，{'超過' if total > 100 else '還差'} {abs(total - 100):g}%",
        "why": "比例乘上合約額就是各期金額。不是 100% 表示合約有一段沒被涵蓋，或有一條重複算了",
        "action": "檢查是不是漏了某一期，或某一筆比例填錯",
        "link": f"/billing?project={project.pk}&tab=milestones",
    }


def _check_phases(project, phases, milestones):
    """里程碑有沒有綁期別。這是「綁定」實際發生的地方"""
    if not milestones:
        return None
    bound = [m for m in milestones if m.phase_id]
    auto = [m for m in milestones if m.trigger_type != TriggerType.MANUAL]

    if not phases:
        # 沒有期別不是錯——單期的案子本來就不用分
        return {
            "key": "phase_binding",
            "title": "里程碑綁定期別",
            "status": OK,
            "detail": "這個案子不分期，所有里程碑以全案為範圍",
            "why": "",
            "action": "若合約其實是分期的，先到專案頁建立期別再回來綁定",
            "link": f"/projects?open={project.pk}",
        }

    unbound_auto = [m for m in auto if not m.phase_id]
    if unbound_auto:
        return {
            "key": "phase_binding",
            "title": "里程碑綁定期別",
            "status": WARN,
            "detail": (
                f"有 {len(unbound_auto)} 筆自動觸發的里程碑沒綁期別："
                + "、".join(m.label for m in unbound_auto[:3])
            ),
            "why": (
                "這個案子分了 "
                + "、".join(p.name for p in phases)
                + "。沒綁期別的里程碑會看【全案所有批次】——"
                "「第一期請款」若沒綁第一期，要等第二期的批次也全簽收才會觸發"
            ),
            "action": "編輯該筆里程碑，在「適用期別」選對應的期",
            "link": f"/billing?project={project.pk}&tab=milestones",
        }
    return {
        "key": "phase_binding",
        "title": "里程碑綁定期別",
        "status": OK,
        "detail": f"{len(bound)} / {len(milestones)} 筆已綁定期別",
        "why": "", "action": "", "link": "",
    }


def _check_unit_phase(project, phases, units):
    """批次有沒有歸期別。綁定的另一半——兩邊都要歸到同一期才對得上"""
    if not phases or not units:
        return None
    orphans = [u for u in units if not u.phase_id]
    if not orphans:
        return {
            "key": "unit_phase",
            "title": "追蹤單元歸屬期別",
            "status": OK,
            "detail": f"{len(units)} 個追蹤單元都已歸到期別",
            "why": "", "action": "", "link": "",
        }
    return {
        "key": "unit_phase",
        "title": "追蹤單元歸屬期別",
        "status": WARN,
        "detail": (
            f"有 {len(orphans)} 個追蹤單元沒歸期別："
            + "、".join(u.name for u in orphans[:3])
            + ("…" if len(orphans) > 3 else "")
        ),
        "why": (
            "★ 批次不是直接綁到里程碑上的——**兩邊都綁到期別**，靠期別對上。"
            "沒歸期別的批次簽收時，找不到對應的里程碑，就不會觸發請款"
        ),
        "action": "編輯這些追蹤單元，選對應的期別",
        "link": f"/tracking?project={project.pk}",
    }


def _check_weight(project, milestones, units):
    """兩種觸發方式要靠重量算佔比，沒填就算不出來"""
    need_weight = [
        m for m in milestones
        if m.trigger_type in (TriggerType.PER_BATCH, TriggerType.WEIGHT_THRESHOLD)
    ]
    if not need_weight:
        return None

    scope = set()
    for m in need_weight:
        for u in units:
            if m.phase_id is None or u.phase_id == m.phase_id:
                scope.add(u.pk)
    relevant = [u for u in units if u.pk in scope]
    missing = [u for u in relevant if not u.total_weight_kg]

    if not relevant:
        return {
            "key": "weight",
            "title": "批次填寫總重量",
            "status": BLOCK,
            "detail": "有按重量計價的里程碑，但對應範圍內還沒有任何批次",
            "why": "重量是分批請款的分母，沒有批次就沒有分母",
            "action": "先建立追蹤單元並填總重量",
            "link": f"/tracking?project={project.pk}",
        }
    if missing:
        return {
            "key": "weight",
            "title": "批次填寫總重量",
            "status": BLOCK,
            "detail": (
                f"{len(missing)} / {len(relevant)} 個批次沒填總重量："
                + "、".join(u.name for u in missing[:3])
                + ("…" if len(missing) > 3 else "")
            ),
            "why": (
                "「每批按量分批請」與「累計重量達門檻」都要用噸數算佔比。"
                "少填一批，分母就是錯的，算出來的金額也會錯"
            ),
            "action": "編輯這些批次填總重量（限廠長／專案負責人／經營者）",
            "link": f"/tracking?project={project.pk}",
        }
    total = sum(u.total_weight_kg for u in relevant)
    return {
        "key": "weight",
        "title": "批次填寫總重量",
        "status": OK,
        "detail": f"{len(relevant)} 個批次都已填重量，合計 {total / 1000:.1f} 噸",
        "why": "", "action": "", "link": "",
    }


def _check_signoff_stage(project, milestones, units):
    """自動觸發的里程碑，它涵蓋的批次走的流程有沒有需簽收的站。

    ⚠️ 這一項必須**按里程碑的範圍**判斷，不能只看整個專案。

    四種請款觸發方式裡有三種靠 `signoff_date` 判斷。流程裡沒有 ✍ 的站，
    那些追蹤單元**永遠不會有簽收日期**——里程碑就永遠卡在「還差 N 批」，
    而畫面上完全看不出原因。這是會讓整條請款線靜默失效的設定錯誤，
    所以是 BLOCK 不是 WARN。
    """
    auto = [m for m in milestones if m.trigger_type != TriggerType.MANUAL]
    if not auto or not units:
        return None

    # {模板 id: 有沒有需簽收的站}
    signable = {}
    for unit in units:
        if unit.template_id not in signable:
            signable[unit.template_id] = any(
                s.is_active and s.requires_signoff for s in unit.template.stages.all()
            )

    broken = []  # (里程碑, 卡住的流程名稱集合, 受影響批次數)
    for milestone in auto:
        scope = [
            u for u in units
            if milestone.phase_id is None or u.phase_id == milestone.phase_id
        ]
        bad = [u for u in scope if not signable.get(u.template_id)]
        if bad:
            broken.append((
                milestone,
                sorted({u.template.name for u in bad}),
                len(bad),
            ))

    if not broken:
        return {
            "key": "signoff_stage",
            "title": "流程含「需簽收」站",
            "status": OK,
            "detail": "自動觸發的里程碑，涵蓋的批次都走得到簽收站",
            "why": "", "action": "", "link": "",
        }

    lines = [
        f"「{m.label}」涵蓋的 {n} 個單元走「{'、'.join(names)}」，這條流程沒有需簽收的站"
        for m, names, n in broken[:3]
    ]
    return {
        "key": "signoff_stage",
        "title": "流程含「需簽收」站",
        "status": BLOCK,
        "detail": "；".join(lines),
        "why": (
            "「該期全部簽收」「累計重量達門檻」「每批按量分批請」三種都靠簽收日期判斷。"
            "流程裡沒有標記 ✍ 的站，那些單元永遠不會有簽收日期——"
            "**里程碑會永遠卡在「還差 N 批」，而且看不出原因**"
        ),
        "action": (
            "兩條路：① 請系統管理員到 /admin/masters/stagetemplate/ "
            "把該流程的驗收站勾選「需簽收」（土建建議勾在「監造查驗」）；"
            "② 或把這筆里程碑改成「手動」，由會計自己按"
        ),
        "link": f"/billing?project={project.pk}&tab=milestones",
    }


def check_all(projects):
    """多個專案的簡表。給請款頁在沒選專案時顯示「哪幾個案子還沒設定好」"""
    rows = []
    for project in projects:
        result = check(project)
        if not result["ready"] or result["warning_count"]:
            rows.append({
                "project_id": project.pk,
                "project_name": project.name,
                "summary": result["summary"],
                "blocking_count": result["blocking_count"],
                "warning_count": result["warning_count"],
            })
    return rows
