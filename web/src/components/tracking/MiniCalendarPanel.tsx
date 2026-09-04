/**
 * 甘特圖右上角的小日曆（D49）
 *
 * 回答的問題：**這一天（或這段日子）有哪些案子的哪些流程在跑、
 * 哪些錢要進出**。點一天看那天；點兩天看範圍（再點一次重選）。
 *
 * D55：點完第一下之後，游標掃過的那段會先變成淺藍色——
 * 不然使用者不知道自己已經點過第一下、系統正在等第二下。
 *
 * 帳款列只有看得到金流的人（經理、會計師）才會出現——
 * 員工開這個面板只看得到流程。
 */
import { Calendar, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { useMilestones, usePayables } from "@/api/hooks";
import { useCurrentUser } from "@/api/hooks/useAuth";
import type { FlowUnit } from "@/api/types";
import FlowStateBadge from "@/components/tracking/FlowStateBadge";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function isoOf(y: number, m: number, d: number) {
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}
function todayIso() {
  const t = new Date();
  return isoOf(t.getFullYear(), t.getMonth(), t.getDate());
}

export default function MiniCalendarPanel({
  units,
  onOpenUnit,
}: {
  units: FlowUnit[];
  onOpenUnit: (id: number) => void;
}) {
  const { data: user } = useCurrentUser();
  const canMoney = Boolean(user?.permissions.view_money);
  const [open, setOpen] = useState(true);
  const [view, setView] = useState(() => {
    const t = new Date();
    return { y: t.getFullYear(), m: t.getMonth() };
  });
  const [start, setStart] = useState<string>(todayIso());
  // 一開始就是「今天這一天」（起訖同一天）而不是等第二下——
  // 不然開面板後的第一下會變成「選到今天為止的一段」，跟直覺相反
  const [end, setEnd] = useState<string | null>(todayIso());
  // 已經點了第一下、還在等第二下時，游標指到哪就預覽到哪（D55）
  const [hover, setHover] = useState<string | null>(null);

  // 帳款：只有看得到金流的人才抓（員工連請求都不發）
  const milestones = useMilestones({ page_size: 200 }, canMoney && open);
  const payables = usePayables({ page_size: 200 }, canMoney && open);

  const a = start;
  const b = end ?? start;

  // 等第二下：已經有起點、還沒有終點
  const pending = end === null && Boolean(start);
  // 預覽範圍（起點 → 游標）。往回指的話點下去是「改起點」，不預覽成一段
  const previewEnd = pending && hover && hover > start ? hover : null;

  function pickDay(iso: string) {
    setHover(null);
    if (end !== null || !start) {
      setStart(iso);
      setEnd(null);
    } else if (iso >= start) {
      setEnd(iso);
    } else {
      setStart(iso);
    }
  }

  // 這個月每一天有沒有事——日曆格子上的小點
  const dayMarks = useMemo(() => {
    const marks = new Map<string, { flow: boolean; money: boolean }>();
    const monthStart = isoOf(view.y, view.m, 1);
    const monthEnd = isoOf(view.y, view.m, new Date(view.y, view.m + 1, 0).getDate());
    for (const u of units) {
      if (!u.plan_start || !u.plan_end || u.state === "na") continue;
      if (u.plan_end < monthStart || u.plan_start > monthEnd) continue;
      const from = u.plan_start < monthStart ? monthStart : u.plan_start;
      const to = u.plan_end > monthEnd ? monthEnd : u.plan_end;
      const d = new Date(from);
      while (true) {
        const key = isoOf(d.getFullYear(), d.getMonth(), d.getDate());
        if (key > to) break;
        const m = marks.get(key) ?? { flow: false, money: false };
        m.flow = true;
        marks.set(key, m);
        d.setDate(d.getDate() + 1);
      }
    }
    const moneyDates = [
      ...(milestones.data?.results ?? []).map((m) => m.forecast_date ?? m.due_date),
      ...(payables.data?.results ?? []).map((p) => p.cash_date ?? p.due_date),
    ];
    for (const date of moneyDates) {
      if (!date || date < monthStart || date > monthEnd) continue;
      const m = marks.get(date) ?? { flow: false, money: false };
      m.money = true;
      marks.set(date, m);
    }
    return marks;
  }, [units, milestones.data, payables.data, view]);

  // 選取範圍內的內容
  const flowsInRange = useMemo(
    () =>
      units.filter(
        (u) =>
          u.state !== "na" &&
          u.plan_start && u.plan_end &&
          u.plan_start <= b && u.plan_end >= a,
      ),
    [units, a, b],
  );
  const byProject = useMemo(() => {
    const map = new Map<string, FlowUnit[]>();
    for (const u of flowsInRange) {
      map.set(u.project_name, [...(map.get(u.project_name) ?? []), u]);
    }
    return [...map.entries()];
  }, [flowsInRange]);

  const moneyRows = useMemo(() => {
    if (!canMoney) return [];
    const rows: Array<{
      key: string;
      kind: "in" | "out";
      date: string;
      title: string;
      project: string;
      amount: number;
      state: string;
      to: string;
    }> = [];
    for (const m of milestones.data?.results ?? []) {
      const date = m.forecast_date ?? m.due_date;
      if (!date || date < a || date > b) continue;
      rows.push({
        key: `m${m.id}`, kind: "in", date,
        title: m.label, project: m.project_name,
        amount: Number(m.amount), state: m.state_label,
        to: `/finance?milestone=${m.id}`,
      });
    }
    for (const p of payables.data?.results ?? []) {
      const date = p.cash_date ?? p.due_date;
      if (!date || date < a || date > b) continue;
      rows.push({
        key: `p${p.id}`, kind: "out", date,
        title: p.title, project: p.project_name,
        amount: Number(p.payable_amount), state: p.state_label,
        to: `/finance?tab=out&payable=${p.id}`,
      });
    }
    return rows.sort((x, y) => x.date.localeCompare(y.date));
  }, [canMoney, milestones.data, payables.data, a, b]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="absolute right-2 top-2 z-30 flex items-center gap-1 rounded-lg bg-card px-2 py-1.5 text-xs font-semibold text-ink-2 shadow-md ring-1 ring-line hover:bg-page"
      >
        <Calendar size={13} />
        小日曆
      </button>
    );
  }

  // 這個月的格子（前面補到週一開頭）
  const firstWeekday = (new Date(view.y, view.m, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const today = todayIso();

  return (
    <div className="absolute right-2 top-2 z-30 flex max-h-[calc(100%-16px)] w-72 flex-col rounded-xl bg-card shadow-lg ring-1 ring-line">
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        <Calendar size={13} className="shrink-0 text-ink-3" />
        <button
          type="button"
          aria-label="上個月"
          onClick={() => setView((v) => (v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }))}
          className="rounded p-0.5 text-ink-3 hover:bg-page"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="min-w-20 text-center text-xs font-bold tabular-nums text-ink">
          {view.y} 年 {view.m + 1} 月
        </span>
        <button
          type="button"
          aria-label="下個月"
          onClick={() => setView((v) => (v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }))}
          className="rounded p-0.5 text-ink-3 hover:bg-page"
        >
          <ChevronRight size={14} />
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="收起小日曆"
          className="ml-auto rounded p-0.5 text-ink-3 hover:bg-page"
        >
          <X size={14} />
        </button>
      </div>

      {/* 月曆：點一天看那天，點兩天看範圍 */}
      <div className="grid grid-cols-7 gap-px px-2 pt-1.5 text-center text-[11px] text-ink-3">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div
        className="grid grid-cols-7 gap-px px-2 pb-1.5 pt-0.5"
        onMouseLeave={() => setHover(null)}
      >
        {Array.from({ length: firstWeekday }).map((_, i) => (
          <span key={`e${i}`} />
        ))}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const iso = isoOf(view.y, view.m, i + 1);
          const inRange = iso >= a && iso <= b;
          // 淺藍＝點了第一下之後，游標掃過的預覽範圍（D55）
          const inPreview = Boolean(previewEnd && iso > a && iso <= previewEnd);
          const mark = dayMarks.get(iso);
          return (
            <button
              key={iso}
              type="button"
              onClick={() => pickDay(iso)}
              onMouseEnter={() => pending && setHover(iso)}
              onFocus={() => pending && setHover(iso)}
              aria-label={iso}
              className={[
                "relative h-8 rounded-md text-xs tabular-nums transition-base",
                inRange
                  ? "bg-stage-2 font-bold text-white"
                  : inPreview
                    ? "bg-stage-2/20 font-semibold text-ink ring-1 ring-stage-2/40"
                    : iso === today
                      ? "bg-page font-bold text-ink ring-1 ring-line"
                      : "text-ink-2 hover:bg-page",
              ].join(" ")}
            >
              {i + 1}
              {(mark?.flow || mark?.money) && (
                <span className="absolute inset-x-0 bottom-0.5 flex justify-center gap-0.5">
                  {mark.flow && (
                    <span
                      aria-hidden
                      className="h-1 w-1 rounded-full"
                      style={{ background: inRange ? "#fff" : "var(--color-stage-2)" }}
                    />
                  )}
                  {mark.money && (
                    <span
                      aria-hidden
                      className="h-1 w-1 rounded-full"
                      style={{ background: inRange ? "#fff" : "var(--color-ontrack)" }}
                    />
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 選取範圍的內容 */}
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-line px-2 py-1.5">
        <p className="text-xs font-semibold text-ink-2">
          {previewEnd ? `${a} ~ ${previewEnd}` : a === b ? a : `${a} ~ ${b}`}
          <span className="ml-1.5 font-normal text-ink-3">
            {previewEnd
              ? "再點一下選這段"
              : `${flowsInRange.length} 條流程${
                  canMoney && moneyRows.length > 0 ? `·${moneyRows.length} 筆帳款` : ""
                }`}
          </span>
        </p>

        {byProject.length === 0 && moneyRows.length === 0 && (
          <p className="py-3 text-center text-xs text-ink-3">這段日子沒有排任何東西</p>
        )}

        {byProject.map(([project, list]) => (
          <div key={project} className="mt-1.5">
            <p className="truncate text-xs font-bold text-ink">{project}</p>
            <ul className="mt-0.5 space-y-0.5">
              {list.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => onOpenUnit(u.id)}
                    className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs transition-base hover:bg-page"
                  >
                    <span className="min-w-0 flex-1 truncate text-ink-2">
                      {u.flow_name}
                      {u.completion_ratio > 0 && (
                        <span className="ml-1 tabular-nums text-ink-3">{u.completion_ratio}%</span>
                      )}
                    </span>
                    <FlowStateBadge state={u.state} overdue={u.is_overdue} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {moneyRows.length > 0 && (
          <div className="mt-1.5 border-t border-line pt-1.5">
            <p className="text-xs font-bold text-ink">帳款</p>
            <ul className="mt-0.5 space-y-0.5">
              {moneyRows.map((row) => (
                <li key={row.key}>
                  <Link
                    to={row.to}
                    className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs transition-base hover:bg-page"
                  >
                    <span
                      className="shrink-0 font-bold"
                      style={{
                        color: row.kind === "in" ? "var(--color-ontrack)" : "var(--color-delayed)",
                      }}
                    >
                      {row.kind === "in" ? "收" : "付"}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-ink-2">
                      {row.project}·{row.title}
                      <span className="ml-1 text-ink-3">{row.state}</span>
                    </span>
                    <span className="shrink-0 tabular-nums font-semibold text-ink">
                      {row.amount.toLocaleString("zh-TW")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
