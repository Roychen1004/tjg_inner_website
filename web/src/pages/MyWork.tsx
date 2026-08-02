/**
 * 我的工作（手機優先）
 *
 * 回答的問題：**今天我該做什麼**。
 *
 * 三個刻意的決定：
 *   1. 排序由後端決定，不給使用者排序選項——師傅打開手機就該看到最急的在最上面
 *   2. 完全不顯示金額——現場人員不需要知道錢
 *   3. 卡片上直接放「＋1」「下一步」，不用先點進去再找按鈕
 *
 * 這是整個系統裡唯一「不需要教就會用」的畫面。它必須是。
 */
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardEdit,
  PenLine,
  Plus,
} from "lucide-react";
import { useState } from "react";

import { ApiError } from "@/api/client";
import { useMoveStage, useMyWork, useReportProgress } from "@/api/hooks";
import type { TrackingCard } from "@/api/types";
import UnitPanel, { type PanelMode } from "@/components/tracking/UnitPanel";
import { Button, EmptyState, ErrorState, ProgressBar, Spinner, StatusBadge } from "@/components/ui";
import { describeSideEffects, useToast } from "@/components/ui/Toast";

export default function MyWork() {
  const { data, isLoading, error, refetch } = useMyWork();
  // 卡片上的按鈕直接把面板開在對應的動作，少點一次
  const [selected, setSelected] = useState<{ unit: TrackingCard; mode: PanelMode } | null>(null);
  const open = (unit: TrackingCard, mode: PanelMode = "view") => setSelected({ unit, mode });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!data) return null;

  return (
    <div>
      {data.count > 0 && (
        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          {data.summary.delayed > 0 && (
            <Pill severity="bad" icon={AlertTriangle} label={`延誤 ${data.summary.delayed}`} />
          )}
          {data.summary.atrisk > 0 && (
            <Pill severity="warn" icon={AlertTriangle} label={`注意 ${data.summary.atrisk}`} />
          )}
          {data.summary.awaiting_signoff > 0 && (
            <Pill
              severity="warn"
              icon={PenLine}
              label={`待簽收 ${data.summary.awaiting_signoff}`}
            />
          )}
          <span className="ml-auto self-center text-ink-3">共 {data.count} 件</span>
        </div>
      )}

      {data.count === 0 ? (
        <EmptyState
          title="目前沒有指派給你的工作"
          hint="有新的工作被指派時，會出現在這裡，也會收到通知"
        />
      ) : (
        <ul className="space-y-2.5">
          {data.results.map((unit) => (
            <WorkCard key={unit.id} unit={unit} onOpen={open} />
          ))}
        </ul>
      )}

      <UnitPanel
        unit={selected?.unit ?? null}
        initialMode={selected?.mode}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

function Pill({
  severity,
  icon: Icon,
  label,
}: {
  severity: "bad" | "warn";
  icon: typeof AlertTriangle;
  label: string;
}) {
  const color = severity === "bad" ? "var(--color-delayed)" : "var(--color-atrisk)";
  const bg = severity === "bad" ? "var(--color-delayed-bg)" : "var(--color-atrisk-bg)";
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-1 font-semibold"
      style={{ color, background: bg }}
    >
      <Icon size={12} />
      {label}
    </span>
  );
}

function WorkCard({
  unit,
  onOpen,
}: {
  unit: TrackingCard;
  onOpen: (unit: TrackingCard, mode?: PanelMode) => void;
}) {
  const report = useReportProgress();
  const move = useMoveStage();
  const toast = useToast();
  const isBatch = unit.unit_type === "batch";

  function quickAdd() {
    report.mutate(
      { id: unit.id, delta: "1" },
      {
        onSuccess: (result) =>
          toast.success(
            `${unit.name} → ${Number(result.unit.qty_done)} ${unit.unit_of_measure}`,
            result.suggestion ? [result.suggestion.message] : [],
          ),
        onError: (e) =>
          toast.error(e instanceof ApiError ? e.body.detail : "回報失敗，請稍後再試"),
      },
    );
  }

  function advance() {
    move.mutate(
      { id: unit.id, direction: "forward", expected_stage_id: unit.stage_id },
      {
        onSuccess: (result) => {
          const { severity, lines } = describeSideEffects(result);
          toast.show(`${unit.name} 已進入 ${result.unit.stage_name}`, { severity, lines });
        },
        onError: (e) =>
          toast.error(e instanceof ApiError ? e.body.detail : "推進失敗，請稍後再試"),
      },
    );
  }

  return (
    <li className="rounded-xl bg-card p-3 ring-1 ring-line">
      <button type="button" onClick={() => onOpen(unit)} className="block w-full text-left">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[11px] text-ink-3">
              {unit.project_name}
              {unit.phase_name && ` · ${unit.phase_name}`}
            </p>
            <p className="truncate text-sm font-bold text-ink">{unit.name}</p>
          </div>
          <StatusBadge status={unit.status} size="xs" />
        </div>

        <p className="mt-1.5 text-xs text-ink-2">
          目前在 <strong className="text-ink">{unit.stage_name}</strong>
          <span className="text-ink-3">
            （第 {unit.stage_seq}/{unit.stage_total} 站，已 {unit.days_in_stage} 天）
          </span>
        </p>

        <div className="mt-2">
          <ProgressBar
            value={unit.completion_ratio}
            label={
              isBatch
                ? `${Number(unit.qty_done)} / ${Number(unit.qty_total)} ${unit.unit_of_measure}`
                : "完成度"
            }
            color={unit.status === "delayed" ? "var(--color-delayed)" : undefined}
          />
        </div>
      </button>

      {unit.is_awaiting_signoff && (
        <p
          className="mt-2 rounded-lg px-2.5 py-1.5 text-[11px]"
          style={{ background: "var(--color-atrisk-bg)", color: "var(--color-atrisk)" }}
        >
          已進場，等業主簽收
        </p>
      )}

      {/* 現場最常做的三件事直接放在卡片上，不用先點進去再找按鈕。
          「回報進度」開完整面板（可填數量與備註）；「＋1」是最常用的捷徑。 */}
      <div className="mt-2.5 grid grid-cols-2 gap-2">
        {isBatch && unit.can_report && (
          <Button onClick={quickAdd} loading={report.isPending}>
            <Plus size={14} />1 {unit.unit_of_measure}
          </Button>
        )}
        {unit.can_report && (
          <Button onClick={() => onOpen(unit, "report")}>
            <ClipboardEdit size={14} />
            回報進度
          </Button>
        )}
        {unit.can_signoff && (
          <Button variant="primary" onClick={() => onOpen(unit, "signoff")}>
            <PenLine size={14} />
            登錄簽收
          </Button>
        )}
        {unit.can_advance ? (
          <Button variant="primary" onClick={advance} loading={move.isPending}>
            <ArrowRight size={14} />
            下一步
          </Button>
        ) : (
          <span className="flex items-center justify-center gap-1 text-xs text-ink-3">
            <CheckCircle2 size={14} />
            已在最後一站
          </span>
        )}
        {unit.can_rollback && (
          <Button onClick={() => onOpen(unit, "rollback")}>
            <ArrowLeft size={14} />
            退回上一站
          </Button>
        )}
      </div>
    </li>
  );
}
