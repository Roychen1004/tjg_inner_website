/**
 * 追蹤看板
 *
 * 回答的問題：**東西現在卡在哪一步、誰的手上有什麼**。三個視圖：
 *   流程看板　五大階段一欄一欄，卡片＝流程單元，哪欄堆得高就是卡在哪
 *   甘特圖　　日曆式時間軸（滾輪縮放、拖曳平移）看每案排程，可選要看哪個專案
 *   員工　　　一人一卡：手上有什麼、該月完成什麼（D46）
 *
 * 構件批次不在看板上（2026-08-17 拿掉）——批次是「單一案子」的東西，
 * 在專案明細的「構件批次」區塊管理；看板只回答跨案的問題。
 *
 * 手機用橫向捲動（POC 已驗證可行），不改成清單——
 * 改成清單就失去「哪一欄比較高」這個唯一的重點。
 */
import { Filter, Layers } from "lucide-react";
import { useMemo, useState } from "react";

import { useFlowCatalog, useFlowUnits, useOptions } from "@/api/hooks";
import type { FlowUnit } from "@/api/types";
import StaffBoard from "@/components/tracking/StaffBoard";
import TimelineGantt from "@/components/tracking/TimelineGantt";
import FlowStateBadge from "@/components/tracking/FlowStateBadge";
import FlowUnitModal from "@/components/tracking/FlowUnitModal";
import { ErrorState, Select, Spinner } from "@/components/ui";
import { useStickyParams } from "@/lib/stickyParams";

const VIEWS = [
  { key: "flow", label: "流程看板" },
  { key: "calendar", label: "甘特圖" },
  { key: "staff", label: "員工" },
] as const;

// unit 不記——那是「從連結點進來要打開哪張卡」，不是篩選條件
const BOARD_KEYS = ["view", "project", "state", "gantt_projects"];

export default function TrackingBoard() {
  const [searchParams, setSearchParams] = useStickyParams("board.filters", BOARD_KEYS);
  // 舊網址或記住的「batch」視圖已不存在，落回流程看板
  const raw = searchParams.get("view");
  const view = raw === "calendar" || raw === "staff" ? raw : "flow";

  function setParam(name: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(name, value);
    else next.delete(name);
    setSearchParams(next, { replace: true });
  }

  return (
    <div>
      <div className="mb-3 flex rounded-lg bg-page p-0.5">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => setParam("view", v.key)}
            className={[
              "flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-base",
              view === v.key ? "bg-card text-ink shadow-sm" : "text-ink-3",
            ].join(" ")}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === "calendar" ? (
        <CalendarView searchParams={searchParams} setParam={setParam} />
      ) : view === "staff" ? (
        <StaffBoard />
      ) : (
        <FlowBoard searchParams={searchParams} setParam={setParam} />
      )}
    </div>
  );
}

// ── 流程看板：五大階段 × 流程單元 ──────────────────────────────────
function FlowBoard({
  searchParams,
  setParam,
}: {
  searchParams: URLSearchParams;
  setParam: (name: string, value: string) => void;
}) {
  const { data: options } = useOptions();
  const { data: catalog } = useFlowCatalog();
  const [openUnit, setOpenUnit] = useState<number | null>(null);

  const project = searchParams.get("project") ?? "";
  const state = searchParams.get("state") ?? "";

  const { data, isLoading, error, refetch } = useFlowUnits({
    project: project || undefined,
    // 「不適用」不上看板——它是「這個案子沒有這一步」
    state: state || "todo,doing,done",
    page_size: 300,
  });

  // 從通知或「我的任務」的連結過來時帶 ?unit=，直接打開那一張
  const deepLinkUnit = searchParams.get("unit");
  const [openedDeepLink, setOpenedDeepLink] = useState<string | null>(null);
  if (deepLinkUnit && openedDeepLink !== deepLinkUnit) {
    setOpenedDeepLink(deepLinkUnit);
    setOpenUnit(Number(deepLinkUnit));
  }
  if (!deepLinkUnit && openedDeepLink !== null) setOpenedDeepLink(null);

  const units = data?.results ?? [];
  const byStage = useMemo(() => {
    const map = new Map<number, FlowUnit[]>();
    for (const u of units) {
      map.set(u.stage_seq, [...(map.get(u.stage_seq) ?? []), u]);
    }
    return map;
  }, [units]);

  const stages = catalog ?? [];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Filter size={15} className="text-ink-3" />
        <Select
          value={project}
          onChange={(v) => setParam("project", v)}
          options={(options?.projects ?? []).map((p) => ({ value: p.id, label: p.name }))}
          placeholder="全部專案"
        />
        <Select
          value={state}
          onChange={(v) => setParam("state", v)}
          options={(options?.flow_state ?? []).filter((o) => o.value !== "na")}
          placeholder="全部狀態"
        />
        {data && <span className="ml-auto text-xs text-ink-3">共 {data.count} 筆</span>}
      </div>

      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <>
          <div className="scroll-x -mx-4 px-4 pb-2">
            <div className="flex gap-3">
              {stages.map((stage) => {
                const columnUnits = (byStage.get(stage.seq) ?? []).sort((a, b) => a.seq - b.seq);
                return (
                  <section
                    key={stage.id}
                    className="flex w-[260px] shrink-0 flex-col rounded-xl bg-page/60 sm:w-[240px]"
                  >
                    <header
                      className="sticky top-0 flex items-center gap-1.5 rounded-t-xl px-3 py-2"
                      style={{ background: "var(--color-stage-2)" }}
                    >
                      <h2 className="min-w-0 flex-1 truncate text-xs font-bold text-white">
                        {stage.seq}. {stage.name}
                      </h2>
                      <span className="shrink-0 rounded-full bg-white/25 px-1.5 text-[11px] font-bold text-white tabular-nums">
                        {columnUnits.length}
                      </span>
                    </header>
                    <div className="flex flex-col gap-2 p-2">
                      {columnUnits.length === 0 ? (
                        <p className="py-6 text-center text-[11px] text-ink-3">—</p>
                      ) : (
                        columnUnits.map((unit) => (
                          <FlowCard
                            key={unit.id}
                            unit={unit}
                            showProject={!project}
                            onOpen={() => setOpenUnit(unit.id)}
                          />
                        ))
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
          <p className="mt-3 flex items-center gap-1 text-[11px] text-ink-3">
            <Layers size={12} />
            欄位＝五大階段（順序固定）。哪一欄未完成的卡片多，瓶頸就在那裡
          </p>
        </>
      )}

      <FlowUnitModal
        unitId={openUnit}
        onClose={() => {
          setOpenUnit(null);
          if (deepLinkUnit) setParam("unit", "");
        }}
      />
    </div>
  );
}

function FlowCard({
  unit,
  showProject,
  onOpen,
}: {
  unit: FlowUnit;
  showProject: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="rounded-lg bg-card p-2.5 text-left ring-1 ring-line transition-base hover:ring-stage-2"
    >
      <div className="flex items-start justify-between gap-1.5">
        <span className="min-w-0 text-xs font-bold leading-snug text-ink">
          <span className="mr-1 tabular-nums text-ink-3">{unit.flow_code}</span>
          {unit.flow_name}
        </span>
        <FlowStateBadge state={unit.state} overdue={unit.is_overdue} />
      </div>
      {showProject && <p className="mt-1 truncate text-[11px] text-ink-3">{unit.project_name}</p>}
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-2">
        <span>{unit.assignee_name || "未指派"}</span>
        {unit.plan_end && (
          <span style={unit.is_overdue ? { color: "var(--color-delayed)" } : undefined}>
            {unit.plan_end}
          </span>
        )}
        {unit.qty_total !== null && Number(unit.qty_total) > 0 ? (
          <span className="ml-auto tabular-nums">
            {Number(unit.qty_done)}/{Number(unit.qty_total)} {unit.unit_of_measure}
          </span>
        ) : unit.state === "doing" && Number(unit.progress_pct ?? 0) > 0 ? (
          <span className="ml-auto tabular-nums">{Number(unit.progress_pct)}%</span>
        ) : null}
      </div>
    </button>
  );
}

// ── 甘特圖（日曆時間軸） ───────────────────────────────────────────
function CalendarView({
  searchParams,
  setParam,
}: {
  searchParams: URLSearchParams;
  setParam: (name: string, value: string) => void;
}) {
  const { data: options } = useOptions();
  const [openUnit, setOpenUnit] = useState<number | null>(null);

  // 選的專案記在網址（可分享、可回上一頁）；空＝全部。
  // 舊網址可能存了逗號分隔的多選，取第一個
  const selected = (searchParams.get("gantt_projects") ?? "").split(",")[0];

  const { data, isLoading, error, refetch } = useFlowUnits({
    state: "todo,doing,done",
    page_size: 500,
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  return (
    // 甘特圖滿版——跳出置中窄欄，用整個視窗寬度畫時間軸
    <div className="mx-[calc(50%-50vw+8px)]">
      <TimelineGantt
        units={data?.results ?? []}
        projects={options?.projects ?? []}
        selected={selected}
        onSelectProject={(id) => setParam("gantt_projects", id)}
        onOpenUnit={setOpenUnit}
      />
      <FlowUnitModal unitId={openUnit} onClose={() => setOpenUnit(null)} />
    </div>
  );
}
