/**
 * 現金流時間軸（D49）——跟追蹤看板的甘特圖同一套操作：
 * **滾輪縮放、按住拖曳平移**的日曆時間軸。
 *
 * 回答的問題跟表格一樣（未來哪個月會缺錢），但換成「錢什麼時候進出」的
 * 視覺：**一個來源兩行——收入一行、支出一行**（D55：原本擠在同一行的上下緣，
 * 金額字疊在一起看不清楚），落在它預計發生的那一天；
 * 最上面一列是每期淨額與累計。點任何一筆跳到對應的應收／應付。
 *
 * 「來源」除了案子，也包含行政事項（D55）——網路費、清潔費那些。
 */
import { AlertTriangle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import type { CashflowDetail, CashflowForecast } from "@/api/types";
import {
  DAY,
  buildCalendar,
  buildWeekends,
  iso,
  startOfDay,
} from "@/components/tracking/TimelineGantt";
import { fmtMD } from "@/lib/format";

const LABEL_W = 192; // w-48
const MIN_DAYS = 14;
const MAX_DAYS = 750;
/** 後端給行政收支的來源名稱（cashflow_service.AFFAIR_GROUP） */
const AFFAIR_GROUP = "行政事項";

type Event = CashflowDetail & { ts: number };

/** 一個來源（案子或行政）＝一組，收入與支出各佔一行 */
interface Group {
  project: string;
  in: Event[];
  out: Event[];
}

export default function CashflowTimeline({ data }: { data: CashflowForecast }) {
  const navigate = useNavigate();
  const today = +startOfDay(new Date());
  const [vp, setVp] = useState(() => ({ start: today - 14 * DAY, days: 150 }));

  const chartRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(800);
  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setChartWidth(el.clientWidth));
    ro.observe(el);
    setChartWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const timelineWidth = Math.max(chartWidth - LABEL_W, 80);
  const pxPerDay = timelineWidth / vp.days;

  const span = vp.days * DAY;
  const winStart = vp.start;
  const winEnd = vp.start + span;
  const x = (ts: number) => ((ts - winStart) / span) * 100;

  // 滾輪縮放（以游標為錨點）；React 的 onWheel 是 passive，要掛原生事件
  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left - LABEL_W;
      const ratio = Math.min(Math.max(px / Math.max(rect.width - LABEL_W, 1), 0), 1);
      setVp((prev) => {
        const factor = Math.exp(e.deltaY * 0.004);
        const days = Math.min(Math.max(prev.days * factor, MIN_DAYS), MAX_DAYS);
        if (days === prev.days) return prev;
        const anchor = prev.start + ratio * prev.days * DAY;
        return { start: anchor - ratio * days * DAY, days };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // 按住拖曳平移（不用 pointer capture，點事件才進得了明細）
  const suppressClick = useRef(false);
  const pxPerDayRef = useRef(pxPerDay);
  pxPerDayRef.current = pxPerDay;
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || !e.isPrimary) return;
    const origin = { x: e.clientX, y: e.clientY, start: vp.start };
    let lastY = e.clientY;
    suppressClick.current = false;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - origin.x;
      const step = ev.clientY - lastY;
      lastY = ev.clientY;
      if (Math.abs(dx) > 4 || Math.abs(ev.clientY - origin.y) > 4) suppressClick.current = true;
      setVp((prev) => ({ ...prev, start: origin.start - (dx / pxPerDayRef.current) * DAY }));
      if (step !== 0) window.scrollBy(0, -step);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function openDetail(d: CashflowDetail) {
    if (suppressClick.current) return;
    if (d.source_kind === "affair") navigate(`/affairs?date=${d.date}`);
    else if (d.kind === "milestone") navigate(`/finance?milestone=${d.id}`);
    else if (d.kind === "payable") navigate(`/finance?tab=out&payable=${d.id}`);
    else navigate("/finance?tab=out");
  }

  // 一個來源一組、收支各一行；事件＝各格明細攤平（日期是真正的預計收付日）
  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    for (const cell of data.cells) {
      for (const d of cell.details) {
        const group = map.get(d.project) ?? { project: d.project, in: [], out: [] };
        group[d.direction].push({ ...d, ts: +startOfDay(new Date(d.date)) });
        map.set(d.project, group);
      }
    }
    // 行政排最後——看的人先找自己的案子
    return [...map.values()].sort(
      (a, b) =>
        Number(a.in.length + a.out.length === 0) - Number(b.in.length + b.out.length === 0) ||
        (a.project === AFFAIR_GROUP ? 1 : 0) - (b.project === AFFAIR_GROUP ? 1 : 0) ||
        a.project.localeCompare(b.project, "zh-TW"),
    );
  }, [data]);

  const { ticks, months } = useMemo(
    () => buildCalendar(winStart, winEnd, pxPerDay),
    [winStart, winEnd, pxPerDay],
  );
  const weekends = useMemo(
    () => (pxPerDay >= 10 ? buildWeekends(winStart, winEnd, span) : []),
    [winStart, winEnd, span, pxPerDay],
  );
  const todayPct = today + DAY > winStart && today < winEnd ? x(today + DAY / 2) : null;
  const crossYear = new Date(winStart).getFullYear() !== new Date(winEnd - 1).getFullYear();

  function RowBackdrop() {
    return (
      <>
        {weekends.map((w) => (
          <div
            key={w.left}
            aria-hidden
            className="absolute inset-y-0 bg-page/70"
            style={{ left: `${w.left}%`, width: `${w.width}%` }}
          />
        ))}
        {ticks.map((t) => (
          <div
            key={t.ts}
            aria-hidden
            className={`absolute inset-y-0 w-px ${t.strong ? "bg-ink-3/40" : "bg-line"}`}
            style={{ left: `${x(t.ts)}%` }}
          />
        ))}
        {todayPct !== null && (
          <div
            aria-hidden
            className="absolute inset-y-0 z-10 w-px"
            style={{ left: `${todayPct}%`, background: "var(--color-ink-3)" }}
          />
        )}
      </>
    );
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold tabular-nums text-ink">
          {fmtMD(iso(winStart), true)} ~ {fmtMD(iso(winEnd - DAY), crossYear)}
        </span>
        <button
          type="button"
          onClick={() =>
            setVp((prev) => ({ ...prev, start: today - Math.round(prev.days / 6) * DAY }))
          }
          className="rounded-lg px-2 py-1 text-xs font-semibold text-ink-2 ring-1 ring-line hover:bg-page"
        >
          今天
        </button>
        <span className="ml-auto text-xs text-ink-3">
          預測範圍：未來 {data.periods} 個月（更遠的錢不畫——那個數字沒有意義）
        </span>
      </div>

      <div
        ref={chartRef}
        onPointerDown={onPointerDown}
        className="cursor-grab touch-pan-y select-none overflow-hidden rounded-xl bg-card ring-1 ring-line active:cursor-grabbing"
      >
        {/* 表頭：月份帶＋日期格（跟追蹤看板同一套） */}
        <div className="border-b border-line bg-page/60">
          <div className="flex">
            <div className="w-48 shrink-0 px-2 pt-1 text-sm font-semibold text-ink-2">來源</div>
            <div className="relative h-[18px] min-w-0 flex-1">
              {months.map((m) => (
                <span
                  key={m.ts}
                  className="absolute top-0.5 whitespace-nowrap text-[11px] font-bold text-ink-2"
                  style={{ left: `${x(m.labelTs)}%`, transform: "translateX(-50%)" }}
                >
                  {m.label}
                </span>
              ))}
            </div>
          </div>
          <div className="flex">
            <div className="w-48 shrink-0" />
            <div className="relative h-[18px] min-w-0 flex-1">
              <RowBackdrop />
              {ticks.map(
                (t) =>
                  t.label && (
                    <span
                      key={t.ts}
                      className="absolute top-0.5 whitespace-nowrap text-[10px] tabular-nums text-ink-3"
                      style={{ left: `${x(t.labelTs)}%`, transform: "translateX(-50%)" }}
                    >
                      {t.label}
                    </span>
                  ),
              )}
              {todayPct !== null && (
                <span
                  className="absolute top-0.5 z-10 -translate-x-1/2 rounded-sm bg-card/90 px-px text-[10px] font-semibold text-ink"
                  style={{ left: `${todayPct}%` }}
                >
                  今天
                </span>
              )}
            </div>
          </div>
        </div>

        {/* 淨額列：每期一個帶正負號的數字，累計轉負的期別標紅 */}
        <div className="flex border-b border-line/60">
          <div className="flex w-48 shrink-0 items-center px-2 py-1 text-xs font-bold text-ink">
            每期淨額
          </div>
          <div className="relative min-h-7 min-w-0 flex-1">
            <RowBackdrop />
            {data.cells.map((cell) => {
              const s = +startOfDay(new Date(cell.start));
              const e = +startOfDay(new Date(cell.end)) + DAY;
              if (e <= winStart || s >= winEnd) return null;
              const net = Number(cell.net);
              const short = Number(cell.cumulative) < 0;
              if (!net && !short) return null;
              const mid = (Math.max(s, winStart) + Math.min(e, winEnd)) / 2;
              return (
                <span
                  key={cell.key}
                  title={`${cell.label}：淨額 ${net.toLocaleString("zh-TW")} 元、累計 ${Number(cell.cumulative).toLocaleString("zh-TW")} 元`}
                  className="absolute top-1/2 z-[5] -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-sm px-1 text-[11px] font-bold tabular-nums"
                  style={{
                    left: `${x(mid)}%`,
                    color: short
                      ? "var(--color-delayed)"
                      : net >= 0
                        ? "var(--color-ontrack)"
                        : "var(--color-delayed)",
                    background: short ? "var(--color-delayed-bg)" : undefined,
                  }}
                >
                  {short && <AlertTriangle size={9} className="mr-0.5 inline" aria-hidden />}
                  {net >= 0 ? "+" : "−"}
                  {compact(Math.abs(net))}
                </span>
              );
            })}
          </div>
        </div>

        {groups.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-ink-3">
            這段期間沒有預計的收付——換個確定性或把期間拉長
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.project} className="border-b border-line last:border-b-0">
              {/* D55：收入與支出各一行。擠在同一行時金額字會疊在一起 */}
              {(["in", "out"] as const)
                .filter((dir) => group[dir].length > 0)
                .map((dir, index) => (
                  <div key={dir} className="flex border-b border-line/40 last:border-b-0">
                    <div className="flex w-48 shrink-0 items-center gap-1.5 px-2 py-1">
                      <span
                        className="shrink-0 rounded px-1 py-px text-[11px] font-bold text-white"
                        style={{
                          background:
                            dir === "in" ? "var(--color-ontrack)" : "var(--color-delayed)",
                        }}
                      >
                        {dir === "in" ? "收" : "付"}
                      </span>
                      <span
                        className={[
                          "truncate text-xs leading-tight",
                          index === 0 ? "font-semibold text-ink" : "text-ink-3",
                        ].join(" ")}
                        title={group.project}
                      >
                        {group.project}
                      </span>
                    </div>
                    <div className="relative min-h-9 min-w-0 flex-1">
                      <RowBackdrop />
                      {group[dir]
                        .filter((ev) => ev.ts + DAY > winStart && ev.ts < winEnd)
                        .map((ev, i) => {
                          const isIn = dir === "in";
                          const amount = Number(ev.amount);
                          const roomy = pxPerDay >= 3;
                          return (
                            <button
                              key={`${ev.kind}-${ev.id}-${i}`}
                              type="button"
                              onClick={() => openDetail(ev)}
                              title={`${ev.project}·${ev.title}\n${ev.date} ${isIn ? "收" : "付"} ${amount.toLocaleString("zh-TW")} 元（${ev.party}）\n${ev.note}`}
                              className={[
                                "absolute top-1/2 z-[5] -translate-x-1/2 -translate-y-1/2",
                                "whitespace-nowrap rounded px-1 py-0.5 text-[11px] font-bold",
                                "leading-4 tabular-nums text-white",
                                ev.certainty === "estimated" ? "opacity-55" : "",
                              ].join(" ")}
                              style={{
                                left: `${x(ev.ts + DAY / 2)}%`,
                                background: isIn
                                  ? "var(--color-ontrack)"
                                  : "var(--color-delayed)",
                              }}
                            >
                              {roomy ? `${isIn ? "+" : "−"}${compact(amount)}` : "●"}
                            </button>
                          );
                        })}
                    </div>
                  </div>
                ))}
            </div>
          ))
        )}
      </div>

      <p className="mt-2 text-xs leading-relaxed text-ink-3">
        <b className="text-ink-2">滾輪＝放大縮小時間</b>、<b className="text-ink-2">按住拖曳＝移動</b>。
        一個來源兩行：<span style={{ color: "var(--color-ontrack)" }}>「收」＝預計收入</span>、
        <span style={{ color: "var(--color-delayed)" }}>「付」＝預計支出</span>，
        半透明＝預估級（日期是人填或均攤的）。最後一組「行政事項」是公司的行政收支（D55）。
        最上列是每期淨額，
        <AlertTriangle size={10} className="mx-0.5 inline" style={{ color: "var(--color-delayed)" }} />
        ＝累計到那一期轉負。點任何一筆跳到對應的應收／應付。
      </p>
    </div>
  );
}

/** 金額縮寫：1.2億、3,450萬、82萬、5.6萬、9,800 */
function compact(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1).replace(/\.0$/, "")}億`;
  if (n >= 10_000) return `${Math.round(n / 10_000).toLocaleString("zh-TW")}萬`;
  return n.toLocaleString("zh-TW");
}
