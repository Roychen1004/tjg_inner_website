/**
 * 追蹤看板
 *
 * 回答的問題：**東西現在卡在哪一站**。
 *
 * 每個階段一欄，卡片堆在自己的階段底下。
 * 哪一欄特別高，就是瓶頸在哪裡——這是表格永遠給不了的資訊。
 *
 * 手機用橫向捲動（POC 已驗證可行），不改成清單——
 * 改成清單就失去「哪一欄比較高」這個唯一的重點。
 */
import { Filter, Layers, PenLine, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { useBoard, useOptions } from "@/api/hooks";
import { useCurrentUser } from "@/api/hooks/useAuth";
import type { TrackingCard } from "@/api/types";
import UnitForm from "@/components/forms/UnitForm";
import TrackingCardView from "@/components/tracking/TrackingCard";
import UnitPanel from "@/components/tracking/UnitPanel";
import { Button, EmptyState, ErrorState, Select, Spinner } from "@/components/ui";

const UNIT_TYPES = [
  { value: "batch", label: "構件批次（鋼構）" },
  { value: "work_item", label: "土建工項" },
];

export default function TrackingBoard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: options } = useOptions();
  const { data: user } = useCurrentUser();
  const [selected, setSelected] = useState<TrackingCard | null>(null);
  const [creating, setCreating] = useState(false);

  const project = searchParams.get("project") ?? "";
  const unitType = searchParams.get("unit_type") ?? (project ? "" : "batch");
  const status = searchParams.get("status") ?? "";

  function setParam(name: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(name, value);
    else next.delete(name);
    setSearchParams(next, { replace: true });
  }

  const params = useMemo(
    () => ({
      project: project || undefined,
      unit_type: unitType || undefined,
      status: status || undefined,
    }),
    [project, unitType, status],
  );

  const { data, isLoading, error, refetch } = useBoard(params, Boolean(project || unitType));

  // 從「需要關注」或請款頁的連結過來時會帶 ?unit=，直接把那張卡打開。
  // 沒處理的話點過去只看到一整片看板，還要自己找那一批
  const deepLinkUnit = searchParams.get("unit");
  const [openedDeepLink, setOpenedDeepLink] = useState<string | null>(null);
  if (deepLinkUnit && openedDeepLink !== deepLinkUnit && data) {
    const found = data.columns.flatMap((c) => c.units).find((u) => String(u.id) === deepLinkUnit);
    setOpenedDeepLink(deepLinkUnit);
    if (found) setSelected(found);
  }
  if (!deepLinkUnit && openedDeepLink !== null) setOpenedDeepLink(null);

  return (
    <div>
      {/* 篩選列：一排，不做展開式篩選面板（決策：UI 只留必要的） */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Filter size={15} className="text-ink-3" />
        <Select
          value={project}
          onChange={(v) => setParam("project", v)}
          options={(options?.projects ?? []).map((p) => ({ value: p.id, label: p.name }))}
          placeholder="全部專案"
        />
        <Select
          value={unitType}
          onChange={(v) => setParam("unit_type", v)}
          options={UNIT_TYPES}
          placeholder="全部類型"
        />
        <Select
          value={status}
          onChange={(v) => setParam("status", v)}
          options={options?.status ?? []}
          placeholder="全部狀態"
        />
        {data && (
          <span className="ml-auto text-xs text-ink-3">
            共 {data.total} 筆
            {data.truncated && (
              <span style={{ color: "var(--color-atrisk)" }}>（顯示前 {data.shown} 筆）</span>
            )}
          </span>
        )}
        {user?.permissions.create_tracking && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={15} />
            新增
          </Button>
        )}
      </div>

      {data?.truncated_hint && (
        <p
          className="mb-3 rounded-lg px-3 py-2 text-xs"
          style={{ background: "var(--color-atrisk-bg)", color: "var(--color-atrisk)" }}
        >
          {data.truncated_hint}
        </p>
      )}

      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !data ? (
        <EmptyState title="請先選擇專案或追蹤單元類型" />
      ) : data.total === 0 ? (
        <EmptyState
          title="這個範圍內沒有追蹤單元"
          hint={
            data.template
              ? `流程「${data.template.name}」共 ${data.template.stages.length} 站，目前沒有東西在跑`
              : undefined
          }
        />
      ) : (
        <>
          {/* 桌機：所有欄並排。手機：橫向捲動，一次看到 1.5 欄提示還有更多 */}
          <div className="scroll-x -mx-4 px-4 pb-2">
            <div className="flex gap-3">
              {data.columns.map((column, index) => (
                <Column
                  key={column.stage?.id ?? `other-${index}`}
                  column={column}
                  showProject={!project}
                  onOpen={setSelected}
                />
              ))}
            </div>
          </div>

          <Legend />
        </>
      )}

      <UnitPanel
        unit={selected}
        onClose={() => {
          setSelected(null);
          if (deepLinkUnit) setParam("unit", "");
        }}
      />
      <UnitForm
        open={creating}
        onClose={() => setCreating(false)}
        defaultProject={project ? Number(project) : undefined}
      />
    </div>
  );
}

function Column({
  column,
  showProject,
  onOpen,
}: {
  column: { stage: { id: number; name: string; color: string; requires_signoff: boolean; is_billing_trigger: boolean; is_hold: boolean; is_outsource: boolean } | null; count: number; units: TrackingCard[] };
  showProject: boolean;
  onOpen: (unit: TrackingCard) => void;
}) {
  const stage = column.stage;
  return (
    <section className="flex w-[260px] shrink-0 flex-col rounded-xl bg-page/60 sm:w-[240px]">
      <header
        className="sticky top-0 flex items-center gap-1.5 rounded-t-xl px-3 py-2"
        style={{ background: stage?.color ?? "var(--color-ink-3)" }}
      >
        <h2 className="min-w-0 flex-1 truncate text-xs font-bold text-white">
          {stage?.name ?? "其他流程"}
        </h2>
        {/* 特殊語意用圖示，不用顏色——顏色已經被階段序位用掉了 */}
        {stage?.requires_signoff && <PenLine size={12} className="text-white" aria-label="需簽收" />}
        {stage?.is_billing_trigger && <span className="text-[11px]" aria-label="觸發請款">💰</span>}
        {stage?.is_outsource && <span className="text-[11px]" aria-label="外包">🚚</span>}
        {stage?.is_hold && <span className="text-[11px]" aria-label="等待中">⏸</span>}
        <span className="shrink-0 rounded-full bg-white/25 px-1.5 text-[11px] font-bold text-white tabular-nums">
          {column.count}
        </span>
      </header>

      <div className="flex flex-col gap-2 p-2">
        {column.units.length === 0 ? (
          <p className="py-6 text-center text-[11px] text-ink-3">—</p>
        ) : (
          column.units.map((unit) => (
            <TrackingCardView
              key={unit.id}
              unit={unit}
              onOpen={onOpen}
              showProject={showProject}
            />
          ))
        )}
      </div>
    </section>
  );
}

function Legend() {
  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-3">
      <span className="flex items-center gap-1">
        <Layers size={12} />
        欄位高度＝堆在那一站的數量
      </span>
      <span className="flex items-center gap-1">
        <PenLine size={12} />
        需業主簽收
      </span>
      <span>💰 進入即觸發請款</span>
      <span>🚚 外包加工</span>
      <span>⏸ 等待中，不計產能</span>
    </p>
  );
}
