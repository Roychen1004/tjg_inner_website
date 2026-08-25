/**
 * 員工視圖（追蹤看板的第三個視圖，D46）
 *
 * 回答的問題：**每個員工手上有什麼、這個月做完了什麼**。
 *
 * 一人一張卡：進行中＝負責的流程＋被分到的工段分量（含做到哪），
 * 本月完成＝該月做滿的分配與實際完成的流程（月份可前後切換）。
 * 不含任何金額。點任何一列開流程卡片看細節。
 */
import { CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

import { useStaffWorkload } from "@/api/hooks";
import type { WorkloadAssignment, WorkloadUnit } from "@/api/types";
import FlowStateBadge from "@/components/tracking/FlowStateBadge";
import FlowUnitModal from "@/components/tracking/FlowUnitModal";
import { Card, ErrorState, Spinner } from "@/components/ui";

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(month: string, dir: 1 | -1) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + dir, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function StaffBoard() {
  const [month, setMonth] = useState(currentMonth);
  const { data, isLoading, error, refetch } = useStaffWorkload(month);
  const [openUnit, setOpenUnit] = useState<number | null>(null);

  if (isLoading) return <Spinner />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const staff = data?.staff ?? [];
  const [year, mon] = month.split("-");

  return (
    <div>
      <div className="mb-3 flex items-center gap-1">
        <button
          type="button"
          aria-label="上個月"
          onClick={() => setMonth((m) => shiftMonth(m, -1))}
          className="rounded-lg p-1.5 text-ink-2 ring-1 ring-line hover:bg-page"
        >
          <ChevronLeft size={15} />
        </button>
        <span className="min-w-24 text-center text-sm font-bold tabular-nums text-ink">
          {year} 年 {Number(mon)} 月
        </span>
        <button
          type="button"
          aria-label="下個月"
          onClick={() => setMonth((m) => shiftMonth(m, 1))}
          className="rounded-lg p-1.5 text-ink-2 ring-1 ring-line hover:bg-page"
        >
          <ChevronRight size={15} />
        </button>
        {month !== currentMonth() && (
          <button
            type="button"
            onClick={() => setMonth(currentMonth())}
            className="ml-1 rounded-lg px-2 py-1 text-xs font-semibold text-ink-2 ring-1 ring-line hover:bg-page"
          >
            本月
          </button>
        )}
        <span className="ml-auto text-[11px] text-ink-3">
          進行中＝現在手上的；完成＝{Number(mon)} 月做完的
        </span>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2">
        {staff.map((person) => {
          const openCount = person.open_units.length + person.open_assignments.length;
          const doneCount = person.done_units.length + person.done_assignments.length;
          return (
            <Card key={person.id} className="p-3">
              <div className="flex items-baseline gap-1.5">
                <span className="text-sm font-bold text-ink">{person.name}</span>
                {person.title && person.title !== person.name && (
                  <span className="text-[11px] text-ink-3">{person.title}</span>
                )}
                <span className="ml-auto text-[11px] tabular-nums text-ink-3">
                  手上 {openCount}・本月完成 {doneCount}
                </span>
              </div>

              {openCount === 0 && doneCount === 0 ? (
                <p className="mt-2 text-[11px] text-ink-3">這個月沒有任何指派或完成紀錄</p>
              ) : (
                <>
                  {openCount > 0 && (
                    <div className="mt-2">
                      <p className="text-[11px] font-semibold text-ink-2">進行中</p>
                      <ul className="mt-1 space-y-1">
                        {person.open_units.map((u) => (
                          <UnitRow key={`u${u.id}`} unit={u} onOpen={setOpenUnit} />
                        ))}
                        {person.open_assignments.map((a) => (
                          <AssignmentRow key={`a${a.id}`} row={a} onOpen={setOpenUnit} />
                        ))}
                      </ul>
                    </div>
                  )}
                  {doneCount > 0 && (
                    <div className="mt-2">
                      <p className="text-[11px] font-semibold text-ink-2">本月完成</p>
                      <ul className="mt-1 space-y-1">
                        {person.done_units.map((u) => (
                          <UnitRow key={`u${u.id}`} unit={u} onOpen={setOpenUnit} done />
                        ))}
                        {person.done_assignments.map((a) => (
                          <AssignmentRow key={`a${a.id}`} row={a} onOpen={setOpenUnit} done />
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </Card>
          );
        })}
      </div>

      <FlowUnitModal unitId={openUnit} onClose={() => setOpenUnit(null)} />
    </div>
  );
}

/** 負責的流程一列 */
function UnitRow({
  unit,
  onOpen,
  done = false,
}: {
  unit: WorkloadUnit;
  onOpen: (id: number) => void;
  done?: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(unit.id)}
        className="flex w-full items-center gap-1.5 rounded-md bg-page px-2 py-1 text-left text-[11px] transition-base hover:bg-line/40"
      >
        <span className="min-w-0 flex-1 truncate text-ink">
          <span className="font-semibold">{unit.flow_name}</span>
          <span className="ml-1 text-ink-3">{unit.project_name}</span>
        </span>
        {done ? (
          <span className="shrink-0 tabular-nums text-ink-3">
            <CheckCircle2 size={11} className="mr-0.5 inline" style={{ color: "var(--color-ontrack)" }} />
            {unit.actual_end}
          </span>
        ) : (
          <>
            {unit.plan_end && <span className="shrink-0 tabular-nums text-ink-3">{unit.plan_end}</span>}
            <FlowStateBadge state={unit.state} />
          </>
        )}
      </button>
    </li>
  );
}

/** 被分到的工段分量一列（如「鐵材 切割中 50/100 噸」） */
function AssignmentRow({
  row,
  onOpen,
  done = false,
}: {
  row: WorkloadAssignment;
  onOpen: (id: number) => void;
  done?: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(row.unit)}
        className="flex w-full items-center gap-1.5 rounded-md bg-page px-2 py-1 text-left text-[11px] transition-base hover:bg-line/40"
      >
        <span className="min-w-0 flex-1 truncate text-ink">
          <span className="font-semibold">
            {row.task_name} {row.status}
          </span>
          <span className="ml-1 text-ink-3">
            {row.project_name}·{row.flow_name}
          </span>
        </span>
        <span className="shrink-0 tabular-nums text-ink-2">
          {row.qty_done}/{row.qty_assigned}
          {row.unit_of_measure && ` ${row.unit_of_measure}`}
        </span>
        {done && (
          <span className="shrink-0 tabular-nums text-ink-3">
            <CheckCircle2 size={11} className="mr-0.5 inline" style={{ color: "var(--color-ontrack)" }} />
            {row.reported_at}
          </span>
        )}
      </button>
    </li>
  );
}
