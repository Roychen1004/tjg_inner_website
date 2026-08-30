import { AlertTriangle } from "lucide-react";

import type { GanttBar } from "@/api/types";
import { fmtMD } from "@/lib/format";

/**
 * 專案卡片的迷你甘特：五大階段各一條 bar，不用點開就看得出
 * 「排到哪、做到哪、有沒有落後」。
 *
 * 視覺編碼（依 08_UI設計原則：顏色不單獨傳達資訊）：
 *   日期網格＝直的刻度線（短工期畫週、長工期畫月），下緣標刻度
 *   bar 位置與長度＝該階段所有流程的預計起訖；**粗體＝起訖日期（月/日）**
 *   內部深色填充＝完成比例（done/total，序數藍階）
 *   今天＝一條縱線＋「今天」；逾期＝紅色三角圖示（不只變色）
 *   時間軸跨年時，日期標籤補年份
 */
const DAY = 86400000;

export default function MiniGantt({ bars }: { bars: GanttBar[] }) {
  const rows = bars.filter((b) => b.total > 0);
  if (!rows.length) {
    return <p className="text-xs text-ink-3">尚未勾選流程</p>;
  }

  const dated = rows.filter((b) => b.start && b.end);
  // 一個日期都沒排 → 沒有時間軸可畫，退回純進度條
  if (!dated.length) {
    return (
      <ol className="space-y-1">
        {rows.map((bar) => (
          <li key={bar.seq} className="flex items-center gap-1.5">
            <span className="w-[4.6rem] shrink-0 truncate text-[11px] text-ink-2">{bar.name}</span>
            <div className="h-2 flex-1 rounded-full bg-line">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${bar.total ? (bar.done / bar.total) * 100 : 0}%`,
                  background: "var(--color-stage-2)",
                }}
              />
            </div>
            <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-ink-3">
              {bar.done}/{bar.total}
            </span>
          </li>
        ))}
        <p className="text-[11px] text-ink-3">流程還沒排預計起訖，畫不出時間軸</p>
      </ol>
    );
  }

  const min = Math.min(...dated.map((b) => +new Date(b.start!)));
  const max = Math.max(...dated.map((b) => +new Date(b.end!)));
  const span = Math.max(max - min, DAY);
  // 跨年才補年份——不跨年時 1/10 不會有歧義
  const multiYear = new Date(min).getFullYear() !== new Date(max).getFullYear();
  const today = Date.now();
  const todayPct = today >= min && today <= max ? ((today - min) / span) * 100 : null;
  const ticks = buildTicks(min, max);
  const x = (ts: number) => ((ts - min) / span) * 100;

  const dateLabel =
    "absolute top-3 whitespace-nowrap rounded-sm bg-card/90 px-px text-[10px] font-bold tabular-nums text-ink";

  return (
    <div className="flex gap-1.5">
      {/* 階段名欄 */}
      <div className="shrink-0">
        {rows.map((bar) => (
          <div key={bar.seq} className="flex h-6 w-[4.6rem] items-center">
            <span className="truncate text-[11px] leading-tight text-ink-2">{bar.name}</span>
          </div>
        ))}
      </div>

      {/* 時間軸區：日期網格＋橫條＋粗體起訖 */}
      <div className="relative min-w-0 flex-1">
        {ticks.map((t) => (
          <div
            key={t.ts}
            aria-hidden
            className="absolute bottom-3.5 top-0 w-px bg-line"
            style={{ left: `${x(t.ts)}%` }}
          />
        ))}
        {todayPct !== null && (
          <div
            aria-hidden
            className="absolute bottom-3.5 top-0 z-10 w-px"
            style={{ left: `${todayPct}%`, background: "var(--color-ink-3)" }}
          />
        )}

        {rows.map((bar) => {
          if (!bar.start || !bar.end) return <div key={bar.seq} className="h-6" />;
          const left = x(+new Date(bar.start));
          const width = Math.max(x(+new Date(bar.end)) - left, 1.5);
          const pct = bar.total ? bar.done / bar.total : 0;
          const started = bar.done > 0 || bar.doing > 0;
          const startLabel = fmtMD(bar.start, multiYear);
          const endLabel = fmtMD(bar.end, multiYear);
          // 條太短時兩個標籤會疊在一起，合併成「起–迄」一個標籤
          const narrow = width < (multiYear ? 34 : 22);
          return (
            <div
              key={bar.seq}
              className="relative h-6"
              title={`${bar.name}：${startLabel} ~ ${endLabel}，完成 ${bar.done}/${bar.total}`}
            >
              <div
                className="absolute top-0.5 h-2 rounded-full"
                style={{
                  left: `${left}%`,
                  width: `${width}%`,
                  background: started ? "var(--color-stage-1)" : "var(--color-line)",
                }}
              >
                {pct > 0 && (
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct * 100}%`, background: "var(--color-stage-2)" }}
                  />
                )}
              </div>
              {narrow ? (
                <span
                  className={dateLabel}
                  style={
                    left <= 55
                      ? { left: `${left}%` }
                      : { left: `${Math.min(left + width, 100)}%`, transform: "translateX(-100%)" }
                  }
                >
                  {startLabel}–{endLabel}
                </span>
              ) : (
                <>
                  <span className={dateLabel} style={{ left: `${left}%` }}>
                    {startLabel}
                  </span>
                  <span
                    className={dateLabel}
                    style={{ left: `${left + width}%`, transform: "translateX(-100%)" }}
                  >
                    {endLabel}
                  </span>
                </>
              )}
            </div>
          );
        })}

        {/* 刻度標籤列 */}
        <div className="relative h-3.5">
          {ticks.map((t) => (
            <span
              key={t.ts}
              className="absolute top-0.5 -translate-x-1/2 whitespace-nowrap text-[10px] text-ink-3"
              style={{ left: `${x(t.ts)}%` }}
            >
              {t.label}
            </span>
          ))}
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

      {/* 完成數＋逾期 */}
      <div className="shrink-0">
        {rows.map((bar) => (
          <div key={bar.seq} className="flex h-6 items-center gap-1">
            <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-ink-3">
              {bar.done}/{bar.total}
            </span>
            {bar.overdue ? (
              <AlertTriangle
                size={11}
                className="shrink-0"
                style={{ color: "var(--color-delayed)" }}
                aria-label="有流程逾期"
              />
            ) : (
              <span className="w-[11px] shrink-0" aria-hidden />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 日期網格的刻度：工期 ≤ 10 週畫每週一，否則畫每月 1 號；超過 13 個月隔月標 */
function buildTicks(min: number, max: number): Array<{ ts: number; label: string }> {
  const days = (max - min) / DAY;
  const ticks: Array<{ ts: number; label: string }> = [];
  const start = new Date(min);

  if (days <= 70) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7)); // 下一個週一
    while (+d <= max) {
      ticks.push({ ts: +d, label: `${d.getMonth() + 1}/${d.getDate()}` });
      d.setDate(d.getDate() + 7);
    }
    return ticks;
  }

  const d = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  const months: Date[] = [];
  while (+d <= max) {
    months.push(new Date(d));
    d.setMonth(d.getMonth() + 1);
  }
  const step = months.length > 13 ? 2 : 1;
  months.forEach((m, i) => {
    if (i % step) return;
    // 1 月帶年份——跨年的時間軸才知道換年了
    ticks.push({
      ts: +m,
      label: m.getMonth() === 0 ? `${m.getFullYear()}/1` : `${m.getMonth() + 1}月`,
    });
  });
  return ticks;
}
