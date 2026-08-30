/**
 * 時間軸甘特（追蹤看板的第二個視圖）
 *
 * 回答的問題：**這段時間每個案子排了什麼、天數多長**。
 *
 * 日曆式時間軸（表頭：月份帶＋日期格），滿版顯示，一列一張流程單元、依專案分組。
 * 操作＝連續縮放：**滑鼠滾輪**放大縮小時間維度、**按住拖曳**左右移動時間範圍。
 * 左欄＝每條流程的名稱，**時程在視窗外也不隱藏**（列一直都在，
 * 只是時間軸上釘的是「◀ 起~訖」指示）；條內的正中間寫著流程名稱
 * （如「表面處理」），文字一律在條裡。顏色＝專案識別（Okabe–Ito
 * 色盲安全色盤，固定順序）；逾期加紅色三角——資訊不單靠顏色。
 */
import { AlertTriangle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { FlowUnit, OptionsData } from "@/api/types";
import { Select } from "@/components/ui";
import { fmtMD } from "@/lib/format";
import { projectColor, projectTint } from "@/lib/projectColors";

export const DAY = 86400000;
/** 左側「流程」欄寬（px），要跟 w-56 一致 */
const LABEL_W = 224;
/** 可見天數的上下限：一週 ~ 一年 */
const MIN_DAYS = 7;
const MAX_DAYS = 366;

interface Viewport {
  /** 視窗左緣（當天零點的 timestamp） */
  start: number;
  /** 可見天數（連續值，滾輪縮放） */
  days: number;
}

export default function TimelineGantt({
  units,
  projects,
  selected,
  onSelectProject,
  onOpenUnit,
}: {
  units: FlowUnit[];
  projects: OptionsData["projects"];
  /** 要看的專案 id；空字串＝全部 */
  selected: string;
  onSelectProject: (id: string) => void;
  onOpenUnit: (id: number) => void;
}) {
  const [vp, setVp] = useState<Viewport>(() => ({
    start: +startOfDay(new Date()) - 7 * DAY,
    days: 35,
  }));
  const today = +startOfDay(new Date());

  // 量時間軸的實際寬度（px/天 決定表頭畫到多細）
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
  const winEnd = vp.start + span; // 不含
  const x = (ts: number) => ((ts - winStart) / span) * 100;

  // ── 滾輪縮放（以游標為錨點）──────────────────────────────────────
  // React 17+ 的 onWheel 是 passive listener，preventDefault 沒有用，
  // 要自己掛非 passive 的原生事件才能攔下頁面捲動
  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left - LABEL_W;
      const ratio = Math.min(Math.max(px / Math.max(rect.width - LABEL_W, 1), 0), 1);
      setVp((prev) => {
        // 敏感度調高過一次（0.0015 → 0.004）——滾兩三下就該從月切到週
        const factor = Math.exp(e.deltaY * 0.004);
        const days = Math.min(Math.max(prev.days * factor, MIN_DAYS), MAX_DAYS);
        if (days === prev.days) return prev;
        // 游標指到的那一天在縮放前後留在同一個位置
        const anchor = prev.start + ratio * prev.days * DAY;
        return { start: anchor - ratio * days * DAY, days };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ── 按住拖曳平移 ─────────────────────────────────────────────────
  // 不用 setPointerCapture——capture 會把後續的 click 改派到容器上，
  // 點橫條開明細就失效了。改掛 window 監聽，拖出容器也照樣跟手。
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
      // 左右＝平移時間；上下＝捲動頁面（D44：拖曳可以上下左右移動）
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
  function openUnit(id: number) {
    // 拖了一段距離才放開，那是平移不是點選
    if (suppressClick.current) return;
    onOpenUnit(id);
  }

  // ── 資料 ─────────────────────────────────────────────────────────
  // 每條流程一列，**不因時程在視窗外而隱藏**（D42）——左欄文字永遠都在，
  // 時程在範圍外的列在時間軸上釘一個「◀ 起~訖」指示。依目錄順序排。
  const rows = useMemo(
    () =>
      units
        .filter((u) => u.state !== "na" && (!selected || u.project === Number(selected)))
        .sort((a, b) => a.project - b.project || a.seq - b.seq),
    [units, selected],
  );

  // 依專案分組——同案的流程排在一起，各組前面放一列專案名
  const groups = useMemo(() => {
    const map = new Map<number, { id: number; name: string; units: FlowUnit[] }>();
    for (const u of rows) {
      const g = map.get(u.project) ?? { id: u.project, name: u.project_name, units: [] };
      g.units.push(u);
      map.set(u.project, g);
    }
    return [...map.values()];
  }, [rows]);

  const { ticks, months } = useMemo(
    () => buildCalendar(winStart, winEnd, pxPerDay),
    [winStart, winEnd, pxPerDay],
  );
  const weekends = useMemo(
    () => (pxPerDay >= 10 ? buildWeekends(winStart, winEnd, span) : []),
    [winStart, winEnd, span, pxPerDay],
  );
  const todayPct =
    today + DAY > winStart && today < winEnd ? x(today + DAY / 2) : null;
  const winCrossYear =
    new Date(winStart).getFullYear() !== new Date(winEnd - 1).getFullYear();

  /** 每一列右側時間軸的共用底層：網格線＋週末底色＋今天線 */
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
      {/* 控制列：專案選擇＋目前時間範圍＋回到今天 */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Select
          value={selected}
          onChange={onSelectProject}
          options={projects.map((p) => ({ value: p.id, label: p.name }))}
          placeholder="全部專案"
        />
        <span className="text-sm font-bold tabular-nums text-ink">
          {fmtMD(iso(winStart), true)} ~ {fmtMD(iso(winEnd - DAY), winCrossYear)}
        </span>
        <button
          type="button"
          onClick={() =>
            setVp((prev) => ({ ...prev, start: today - Math.round(prev.days / 4) * DAY }))
          }
          className="rounded-lg px-2 py-1 text-xs font-semibold text-ink-2 ring-1 ring-line hover:bg-page"
        >
          今天
        </button>
      </div>

      {/* 圖本體：滾輪縮放、按住拖曳平移 */}
      <div
        ref={chartRef}
        onPointerDown={onPointerDown}
        className="cursor-grab touch-pan-y select-none overflow-hidden rounded-xl bg-card ring-1 ring-line active:cursor-grabbing"
      >
        {/* 表頭：日曆式兩層——月份帶＋日期格 */}
        <div className="border-b border-line bg-page/60">
          <div className="flex">
            <div className="w-56 shrink-0 px-2 pt-1 text-sm font-semibold text-ink-2">
              流程
            </div>
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
            <div className="w-56 shrink-0" />
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

        {rows.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-ink-3">
            這個範圍沒有任何流程——換一個專案，或到專案分頁勾選流程
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.id} className="border-b border-line/60 last:border-b-0">
              {/* 專案列：多案同看時當分組標題；顏色點＝圖例 */}
              <div className="flex">
                <div className="flex w-56 shrink-0 items-center gap-1.5 px-2 pb-0.5 pt-1.5">
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: projectColor(group.id) }}
                  />
                  <span className="text-xs font-bold leading-tight text-ink">{group.name}</span>
                </div>
                <div className="relative min-w-0 flex-1">
                  <RowBackdrop />
                </div>
              </div>

              {group.units.map((unit) => (
                <GanttRow
                  key={unit.id}
                  unit={unit}
                  winStart={winStart}
                  winEnd={winEnd}
                  x={x}
                  backdrop={<RowBackdrop />}
                  onOpen={openUnit}
                />
              ))}
            </div>
          ))
        )}
      </div>

      <p className="mt-2 text-xs leading-relaxed text-ink-3">
        <b className="text-ink-2">滾輪＝放大縮小時間</b>、<b className="text-ink-2">按住拖曳＝上下左右移動</b>（左右移時間、上下捲畫面）。
        橫條＝流程單元的預計起訖（顏色跟著專案），字都在條裡：中間是這一步在做什麼、
        粗體＝起訖日期（條不夠寬時只留名稱，完整資訊看左欄與滑鼠停留）。
        每條流程的名稱固定在左欄，**時程在範圍外也不會消失**——
        ◀ ▶＝它排在畫面外的那一側，旁邊標著真正的起訖日。淡色打勾＝已完成，
        <AlertTriangle size={10} className="mx-0.5 inline" style={{ color: "var(--color-delayed)" }} />
        ＝已逾期。點橫條看明細。
      </p>
    </div>
  );
}

// ── 一列一張流程單元 ───────────────────────────────────────────────
function GanttRow({
  unit,
  winStart,
  winEnd,
  x,
  backdrop,
  onOpen,
}: {
  unit: FlowUnit;
  winStart: number;
  winEnd: number;
  x: (ts: number) => number;
  backdrop: React.ReactNode;
  onOpen: (id: number) => void;
}) {
  const hasDates = Boolean(unit.plan_start && unit.plan_end);
  const s = hasDates ? +day(unit.plan_start!) : 0;
  const e = hasDates ? +day(unit.plan_end!) + DAY : 0; // 含結束當天
  const inView = hasDates && e > winStart && s < winEnd;

  return (
    <div className="flex">
      {/* 左欄流程名稱：加大、不截斷、永遠都在（時程在範圍外也一樣） */}
      <div className="flex w-56 shrink-0 items-start gap-1.5 py-1 pl-5 pr-2">
        <span className="shrink-0 pt-0.5 text-xs font-semibold tabular-nums text-ink-3">
          {unit.flow_code}
        </span>
        <span className="min-w-0 text-sm leading-tight text-ink">{unit.flow_name}</span>
      </div>
      <div className="relative min-h-7 min-w-0 flex-1 self-stretch">
        {backdrop}
        {!hasDates ? (
          <span className="absolute left-2 top-1/2 z-[5] -translate-y-1/2 text-[11px] text-ink-3">
            未排日期
          </span>
        ) : inView ? (
          <InViewBar unit={unit} winStart={winStart} winEnd={winEnd} x={x} onOpen={onOpen} />
        ) : (
          /* 時程整段在視窗外：在靠它那一側釘個指示，點了一樣開明細 */
          <button
            type="button"
            onClick={() => onOpen(unit.id)}
            title={`${unit.project_name}：${unit.flow_code} ${unit.flow_name}（${unit.plan_start} ~ ${unit.plan_end}）`}
            className={[
              "absolute top-1/2 z-[5] -translate-y-1/2 whitespace-nowrap rounded-sm bg-card/90 px-1 py-0.5 text-[11px] font-semibold tabular-nums text-ink-3",
              e <= winStart ? "left-1" : "right-1",
            ].join(" ")}
          >
            {e <= winStart
              ? `◀ ${fmtMD(unit.plan_start!, true)}~${fmtMD(unit.plan_end!, true)}`
              : `${fmtMD(unit.plan_start!, true)}~${fmtMD(unit.plan_end!, true)} ▶`}
          </button>
        )}
      </div>
    </div>
  );
}

/** 與視窗有交集的橫條。所有文字都在條**裡面**：中間名稱、兩端粗體日期 */
function InViewBar({
  unit,
  winStart,
  winEnd,
  x,
  onOpen,
}: {
  unit: FlowUnit;
  winStart: number;
  winEnd: number;
  x: (ts: number) => number;
  onOpen: (id: number) => void;
}) {
  const s = +day(unit.plan_start!);
  const e = +day(unit.plan_end!) + DAY; // 含結束當天
  const clipLeft = s < winStart;
  const clipRight = e > winEnd;
  const left = x(Math.max(s, winStart));
  const width = Math.max(x(Math.min(e, winEnd)) - left, 0.6);
  // 跨年的單元才補年份（如 2026/12/20 ~ 2027/1/15）
  const crossYear = unit.plan_start!.slice(0, 4) !== unit.plan_end!.slice(0, 4);
  const startLabel = (clipLeft ? "◀" : "") + fmtMD(unit.plan_start!, crossYear);
  const endLabel = fmtMD(unit.plan_end!, crossYear) + (clipRight ? "▶" : "");
  // 條夠寬才連日期一起畫；不夠寬只留中間的名稱（完整資訊在左欄與 title）
  const roomy = width >= (crossYear ? 42 : 30);

  return (
    <button
      type="button"
      onClick={() => onOpen(unit.id)}
      title={`${unit.project_name}：${unit.flow_code} ${unit.flow_name}（${unit.plan_start} ~ ${unit.plan_end}）`}
      className={[
        // D50 字級整批放大（條內 9→10px），條高 2.5→3 才裝得下
        "absolute top-1/2 z-[5] flex h-3 -translate-y-1/2 items-center gap-1 overflow-hidden px-1 text-left text-[10px] leading-none text-ink",
        clipLeft ? "rounded-l-none" : "rounded-l",
        clipRight ? "rounded-r-none" : "rounded-r",
      ].join(" ")}
      style={{
        left: `${left}%`,
        width: `${width}%`,
        background: projectTint(unit.project),
        // 邊框讓相鄰的條分得開（D44）；左緣照舊加粗當起點記號
        border: `1px solid ${projectColor(unit.project)}`,
        borderLeftWidth: clipLeft ? 1 : 3,
        opacity: unit.state === "done" ? 0.55 : 1,
      }}
    >
      {unit.is_overdue && (
        <AlertTriangle size={9} className="shrink-0" style={{ color: "var(--color-delayed)" }} />
      )}
      {roomy && <b className="shrink-0 font-bold tabular-nums">{startLabel}</b>}
      {/* 條的正中間寫這一步在做什麼（如「表面處理」）——一律在條內 */}
      <span className="mx-auto truncate px-0.5 font-semibold">
        {unit.flow_name}
        {unit.state === "done" && " ✓"}
      </span>
      {roomy && <b className="shrink-0 font-bold tabular-nums">{endLabel}</b>}
    </button>
  );
}

// ── 時間計算 ───────────────────────────────────────────────────────
export function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function day(isoDate: string) {
  return startOfDay(new Date(isoDate));
}

export function iso(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface Tick {
  ts: number;
  /** 標籤畫的位置（日期格的中央——日曆的樣子） */
  labelTs: number;
  label: string | null;
  /** 較深的線：月初（或週一） */
  strong: boolean;
}

export interface MonthBand {
  ts: number;
  labelTs: number;
  label: string;
}

/**
 * 日曆式表頭，密度跟著 px/天 自動調：
 *   ≥ 22px/天 → 每天一格、天天標日期
 *   ≥ 8px/天  → 每天細線，週一標日期
 *   ≥ 2.5px/天 → 週一一格，週一標日期
 *   再小      → 只畫月線
 * 月份另外畫一條「月份帶」（2026/8 這種），跨月時一眼就看得到。
 */
export function buildCalendar(
  winStart: number,
  winEnd: number,
  pxPerDay: number,
): { ticks: Tick[]; months: MonthBand[] } {
  const ticks: Tick[] = [];
  const months: MonthBand[] = [];

  const mode =
    pxPerDay >= 22 ? "day" : pxPerDay >= 8 ? "day-line" : pxPerDay >= 2.5 ? "week" : "month";

  // 視窗左緣經過縮放平移後不是整天——刻度要從「那天的零點」開始算，
  // 稍微超出左緣的線讓 overflow-hidden 裁掉就好
  const d = startOfDay(new Date(winStart));
  while (+d < winEnd) {
    const isMonday = d.getDay() === 1;
    const isFirst = d.getDate() === 1;
    const ts = +d;
    if (mode === "day") {
      ticks.push({ ts, labelTs: ts + DAY / 2, label: String(d.getDate()), strong: isMonday || isFirst });
    } else if (mode === "day-line") {
      ticks.push({
        ts, labelTs: ts + DAY / 2,
        label: isMonday ? String(d.getDate()) : null,
        strong: isMonday || isFirst,
      });
    } else if (mode === "week") {
      if (isMonday || isFirst) {
        ticks.push({
          ts, labelTs: ts,
          label: isMonday ? String(d.getDate()) : null,
          strong: isFirst,
        });
      }
    } else if (isFirst) {
      ticks.push({ ts, labelTs: ts, label: null, strong: true });
    }
    d.setDate(d.getDate() + 1);
  }

  // 月份帶：窗內每個月一段，標籤放該月可見範圍的中央
  const first = new Date(winStart);
  let m = new Date(first.getFullYear(), first.getMonth(), 1);
  while (+m < winEnd) {
    const next = new Date(m.getFullYear(), m.getMonth() + 1, 1);
    const from = Math.max(+m, winStart);
    const to = Math.min(+next, winEnd);
    // 太窄的月份（窗邊緣露出幾天）不標，免得跟隔壁月擠在一起
    if ((to - from) / DAY * pxPerDay >= 44) {
      months.push({
        ts: +m,
        labelTs: from + (to - from) / 2,
        label: `${m.getFullYear()}/${m.getMonth() + 1}`,
      });
    }
    m.setMonth(m.getMonth() + 1);
  }

  return { ticks, months };
}

/** 週末底色（六日）。縮太小格子太密就不畫 */
export function buildWeekends(
  winStart: number,
  winEnd: number,
  span: number,
): Array<{ left: number; width: number }> {
  const out: Array<{ left: number; width: number }> = [];
  const d = startOfDay(new Date(winStart));
  while (+d < winEnd) {
    if (d.getDay() === 6 || d.getDay() === 0) {
      out.push({ left: ((+d - winStart) / span) * 100, width: (DAY / span) * 100 });
    }
    d.setDate(d.getDate() + 1);
  }
  return out;
}
