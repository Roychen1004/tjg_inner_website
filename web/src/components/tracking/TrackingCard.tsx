/**
 * 追蹤單元卡片
 *
 * 一張卡只回答四個問題：
 *   這是什麼 · 在哪一站 · 做多少了 · 有沒有卡住
 *
 * 刻意不放的東西：金額、外包廠、簽收單號、建立時間。
 * 那些是明細的事——卡片塞滿了就等於什麼都看不到。
 */
import { AlertTriangle, ChevronRight, Clock, PenLine, Truck } from "lucide-react";

import type { TrackingCard as Card } from "@/api/types";
import { ProgressBar, StatusBadge } from "@/components/ui";

export default function TrackingCardView({
  unit,
  onOpen,
  showProject = true,
}: {
  unit: Card;
  onOpen: (unit: Card) => void;
  showProject?: boolean;
}) {
  // 一張卡最多只顯示一個「注意」標記——三個驚嘆號等於沒有驚嘆號
  const flag = pickFlag(unit);

  return (
    <button
      type="button"
      onClick={() => onOpen(unit)}
      className="w-full rounded-lg bg-card p-2.5 text-left ring-1 ring-line
                 transition-base hover:ring-stage-2"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {showProject && (
            <p className="truncate text-[11px] text-ink-3">{unit.project_name}</p>
          )}
          <p className="truncate text-sm font-semibold text-ink">{unit.name}</p>
        </div>
        <ChevronRight size={15} className="mt-0.5 shrink-0 text-ink-3" />
      </div>

      <div className="mt-2">
        <ProgressBar
          value={unit.completion_ratio}
          compact
          color={unit.status === "delayed" ? "var(--color-delayed)" : undefined}
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        <span className="font-semibold tabular-nums text-ink-2">
          {unit.unit_type === "batch"
            ? `${fmt(unit.qty_done)} / ${fmt(unit.qty_total)} ${unit.unit_of_measure}`
            : `${unit.completion_ratio}%`}
        </span>
        <StatusBadge status={unit.status} size="xs" />
        {flag && (
          <span
            className="inline-flex items-center gap-0.5 font-semibold"
            style={{ color: flag.color }}
          >
            <flag.icon size={11} />
            {flag.label}
          </span>
        )}
      </div>
    </button>
  );
}

function pickFlag(unit: Card) {
  if (unit.is_outsource_overdue) {
    return { icon: Truck, label: "外包逾期", color: "var(--color-delayed)" };
  }
  if (unit.is_awaiting_signoff) {
    return { icon: PenLine, label: "待簽收", color: "var(--color-atrisk)" };
  }
  if (unit.is_stalled) {
    return { icon: Clock, label: `停留 ${unit.days_in_stage} 天`, color: "var(--color-atrisk)" };
  }
  if (unit.rollback_count > 0) {
    return {
      icon: AlertTriangle,
      label: `回退 ${unit.rollback_count} 次`,
      color: "var(--color-atrisk)",
    };
  }
  return null;
}

function fmt(value: string | null) {
  if (value === null) return "—";
  const num = Number(value);
  return Number.isInteger(num) ? String(num) : num.toFixed(1);
}
