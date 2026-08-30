import type { FlowStateCode } from "@/api/types";

/**
 * 流程狀態徽章。圓點＋文字雙重編碼（色盲安全），跟 StatusBadge 同一套語言。
 * 「不適用」刻意最淡——它是「這個案子沒有這一步」，不是一種進度。
 */
const META: Record<FlowStateCode, { label: string; fg: string; bg: string }> = {
  todo: { label: "未開始", fg: "var(--color-ink-3)", bg: "var(--color-page)" },
  doing: { label: "進行中", fg: "var(--color-stage-2)", bg: "var(--color-page)" },
  done: { label: "已完成", fg: "var(--color-ontrack)", bg: "var(--color-ontrack-bg)" },
  na: { label: "不適用", fg: "var(--color-ink-3)", bg: "transparent" },
};

export default function FlowStateBadge({
  state,
  overdue = false,
}: {
  state: FlowStateCode;
  /** 逾期蓋過一切——紅色優先於狀態色 */
  overdue?: boolean;
}) {
  const meta =
    overdue && (state === "todo" || state === "doing")
      ? { label: "逾期", fg: "var(--color-delayed)", bg: "var(--color-delayed-bg)" }
      : META[state];
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-semibold"
      style={{ color: meta.fg, background: meta.bg }}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: meta.fg }} />
      {meta.label}
    </span>
  );
}
