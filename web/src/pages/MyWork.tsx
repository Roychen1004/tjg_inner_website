/**
 * 我的任務
 *
 * 回答的問題：**今天輪到我做什麼**。
 *
 * 員工登入的首頁。任務分兩種來源，用標籤區分（D53）：
 *   🏗 案子　工作分配（被分到的工段分量）與流程單元（當主要負責人）
 *   📋 行政　公司非案子的事務（繳費、打掃……），來自行政日曆
 * 完成不需要主管再確認（老闆定的）——按了完成就是完成。
 */
import { Boxes, Calendar, Check, CheckCircle2, ChevronRight, Play, Repeat } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { Link } from "react-router-dom";

import { ApiError } from "@/api/client";
import {
  useFlowTransition,
  useFlowUnits,
  useMilestones,
  useMyAffairTasks,
  useReportAssignment,
  useStartAssignment,
  useTaskAssignments,
} from "@/api/hooks";
import { useCurrentUser } from "@/api/hooks/useAuth";
import type { AffairTask, FlowTaskAssignment, FlowUnit, Milestone } from "@/api/types";
import AffairTaskCard from "@/components/affairs/AffairTaskCard";
import FlowStateBadge from "@/components/tracking/FlowStateBadge";
import { useUnitPanel } from "@/components/tracking/UnitPanelContext";
import { Button, Card, EmptyState, ErrorState, SectionTitle, Spinner } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";

export default function MyWork() {
  const { data: user } = useCurrentUser();
  const { data, isLoading, error, refetch } = useFlowUnits({
    assignee: "me",
    page_size: 200,
  });
  const assignments = useTaskAssignments({ assignee: "me", open: "true", page_size: 100 });
  // 行政事項（D53）：指派給我、未完成、14 天內（含逾期）
  const affairs = useMyAffairTasks();
  // 指定給我收款的期別（D45）——只有看得到金流的人才抓
  const collectibles = useMilestones(
    { accountant: "me", state: "claimable,invoiced", page_size: 50 },
    Boolean(user?.permissions.view_money),
  );
  const { open: openUnitPanel } = useUnitPanel();

  // 通知的連結帶 ?unit=，點過來直接打開那一張任務
  const [searchParams] = useSearchParams();
  const deepLink = searchParams.get("unit");
  const [openedDeepLink, setOpenedDeepLink] = useState<string | null>(null);
  // 側欄是全域的（D49）——開卡片是跨元件的 setState，要進 effect 不能在 render 裡做
  useEffect(() => {
    if (deepLink && openedDeepLink !== deepLink) {
      setOpenedDeepLink(deepLink);
      openUnitPanel(Number(deepLink));
    }
  }, [deepLink, openedDeepLink, openUnitPanel]);

  if (isLoading) return <Spinner />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const units = (data?.results ?? []).filter((u) => u.state !== "na");
  const myAssignments = assignments.data?.results ?? [];
  const myCollectibles = collectibles.data?.results ?? [];
  const myAffairs = affairs.data ?? [];
  const overdue = units.filter((u) => u.is_overdue);
  const doing = units.filter((u) => u.state === "doing" && !u.is_overdue);
  const todo = units.filter((u) => u.state === "todo" && !u.is_overdue);
  const done = units
    .filter((u) => u.state === "done")
    .sort((a, b) => (b.actual_end ?? "").localeCompare(a.actual_end ?? ""))
    .slice(0, 10);

  if (
    units.length === 0 &&
    myAssignments.length === 0 &&
    myCollectibles.length === 0 &&
    myAffairs.length === 0
  ) {
    return (
      <EmptyState
        title="目前沒有指派給你的任務"
        hint="管理者把流程或工作分配給你之後，會出現在這裡，同時你也會收到通知（右上角鈴鐺）"
      />
    );
  }

  return (
    <div className="space-y-5">
      {myCollectibles.length > 0 && (
        <section>
          <SectionTitle>
            輪到我收款
            <span className="ml-1.5 text-xs font-normal text-ink-3">{myCollectibles.length} 期</span>
          </SectionTitle>
          <ul className="space-y-2">
            {myCollectibles.map((m) => (
              <CollectCard key={m.id} milestone={m} />
            ))}
          </ul>
        </section>
      )}
      {myAffairs.length > 0 && (
        <section>
          <SectionTitle>
            <SourceTag kind="affair" />
            行政事項
            <span className="ml-1.5 text-xs font-normal text-ink-3">{myAffairs.length} 件</span>
          </SectionTitle>
          <ul className="space-y-2">
            {myAffairs.map((t) => (
              <AffairCard key={t.id} task={t} />
            ))}
          </ul>
        </section>
      )}

      {myAssignments.length > 0 && (
        <section>
          <SectionTitle>
            <SourceTag kind="project" />
            分給我的工作
            <span className="ml-1.5 text-xs font-normal text-ink-3">{myAssignments.length} 份</span>
          </SectionTitle>
          <ul className="space-y-2">
            {myAssignments.map((a) => (
              <AssignmentCard key={a.id} assignment={a} onOpen={() => openUnitPanel(a.unit)} />
            ))}
          </ul>
        </section>
      )}

      {overdue.length > 0 && (
        <Group title="逾期——先處理這些" units={overdue} onOpen={openUnitPanel} urgent />
      )}
      {doing.length > 0 && <Group title="進行中" units={doing} onOpen={openUnitPanel} />}
      {todo.length > 0 && <Group title="待開始" units={todo} onOpen={openUnitPanel} />}
      {done.length > 0 && <Group title="最近完成" units={done} onOpen={openUnitPanel} muted />}
    </div>
  );
}

/** 任務來源標籤（D53）——區分「案子的事」與「公司行政的事」 */
function SourceTag({ kind }: { kind: "project" | "affair" }) {
  const affair = kind === "affair";
  return (
    <span
      className="mr-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 align-middle text-xs font-bold"
      style={{
        background: affair ? "var(--color-atrisk-bg)" : "var(--color-page)",
        color: affair ? "var(--color-atrisk)" : "var(--color-ink-2)",
      }}
    >
      {affair ? <Calendar size={11} /> : <Boxes size={11} />}
      {affair ? "行政" : "案子"}
    </span>
  );
}

/** 一件行政事項（D53）：點開卡片回報完成，順便傳收據／照片 */
function AffairCard({ task }: { task: AffairTask }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Card as="li" className="p-0">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-2 p-3 text-left transition-base hover:bg-page"
        >
          <span
            aria-hidden
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-2"
            style={{
              borderColor: task.is_done ? "var(--color-ontrack)" : task.category_color,
              background: task.is_done ? "var(--color-ontrack)" : "transparent",
            }}
          >
            {task.is_done && <Check size={15} className="text-white" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-bold text-ink">{task.title}</span>
              <span
                className="rounded-full px-2 py-0.5 text-xs font-semibold"
                style={{ background: `${task.category_color}1a`, color: task.category_color }}
              >
                {task.category_name}
              </span>
              {task.rule_text && (
                <span className="inline-flex items-center gap-0.5 text-xs text-ink-3">
                  <Repeat size={11} />
                  {task.rule_text}
                </span>
              )}
            </span>
            <span className="mt-0.5 block truncate text-xs text-ink-3">
              <span
                style={
                  task.is_overdue
                    ? { color: "var(--color-delayed)", fontWeight: 600 }
                    : undefined
                }
              >
                {task.date}
                {task.is_overdue && " 逾期"}
              </span>
              {task.note && `　${task.note}`}
            </span>
          </span>
          <ChevronRight size={15} className="shrink-0 text-ink-3" />
        </button>
      </Card>
      {open && <AffairTaskCard task={task} open onClose={() => setOpen(false)} />}
    </>
  );
}

/** 指定給我收款的期別（D45）：點過去金流分頁開單／登收款 */
function CollectCard({ milestone: m }: { milestone: Milestone }) {
  return (
    <Card as="li" className="p-0">
      <Link
        to={`/finance?milestone=${m.id}`}
        className="flex items-center gap-2 p-3 transition-base hover:bg-page"
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-bold text-ink">{m.label}</span>
            <span className="rounded-full bg-page px-2 py-0.5 text-xs font-semibold text-ink-2">
              {m.state_label}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-xs text-ink-3">
            {m.project_name}
            {m.trigger_unit_name && `·由「${m.trigger_unit_name}」完成觸發`}
          </span>
        </span>
        <span className="shrink-0 text-sm font-bold tabular-nums text-ink">
          {Number(m.amount).toLocaleString("zh-TW")} 元
        </span>
        <ChevronRight size={15} className="shrink-0 text-ink-3" />
      </Link>
    </Card>
  );
}

/** 一份分到我頭上的工段分量：直接填完成量回報，做完通知主要負責人 */
function AssignmentCard({
  assignment: a,
  onOpen,
}: {
  assignment: FlowTaskAssignment;
  onOpen: () => void;
}) {
  const report = useReportAssignment();
  const start = useStartAssignment();
  const toast = useToast();
  const [value, setValue] = useState(String(Number(a.qty_done)));

  const assignedNum = Number(a.qty_assigned);
  const pct = assignedNum ? Math.round((Number(a.qty_done) / assignedNum) * 100) : 0;
  // 進行中第幾天（D52）——從按「開始」那天起算
  const dayN = a.started_at
    ? Math.max(1, Math.floor((Date.now() - new Date(a.started_at).getTime()) / 86400000) + 1)
    : null;

  function commit() {
    if (value === "" || Number(value) === Number(a.qty_done)) {
      setValue(String(Number(a.qty_done)));
      return;
    }
    // D52：回報走流水帳端點——一人一天 1 工的計工靠它
    report.mutate(
      { id: a.id, qty_done: value },
      {
        onSuccess: (saved) => {
          setValue(String(Number(saved.qty_done)));
          toast.success(
            `${saved.task_name}·${saved.status} ${Number(saved.qty_done)}/${Number(saved.qty_assigned)}`,
            saved.is_done ? ["這份做完了，主要負責人會收到通知"] : [],
          );
        },
        onError: (e) => {
          setValue(String(Number(a.qty_done)));
          toast.error(e instanceof ApiError ? e.body.detail ?? "回報失敗" : "回報失敗");
        },
      },
    );
  }

  return (
    <Card as="li" className="flex items-center gap-2 p-3">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-ink">
            {a.task_name} {a.status}
            <span className="ml-1.5 font-normal tabular-nums text-ink-2">
              {Number(a.qty_assigned)}
              {a.unit_of_measure && ` ${a.unit_of_measure}`}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-xs text-ink-3">
            {a.project_name}·{a.flow_name}
          </span>
          {/* 經理分配時的叮嚀（D49）——特別標出來，做之前先看這段 */}
          {a.note && (
            <span
              className="mt-1 block rounded-md px-2 py-1 text-xs leading-relaxed"
              style={{ background: "var(--color-atrisk-bg)", color: "var(--color-atrisk)" }}
            >
              📌 經理叮嚀：{a.note}
            </span>
          )}
          <span className="mt-1 block h-1 rounded-full bg-line">
            <span
              className="block h-full rounded-full"
              style={{ width: `${pct}%`, background: "var(--color-stage-2)" }}
            />
          </span>
        </span>
        <ChevronRight size={15} className="shrink-0 text-ink-3" />
      </button>
      <div className="flex shrink-0 flex-col items-end gap-1 text-xs">
        {/* D52：先按開始，經理才看得到你動工了；當日工作結束回報完成量 */}
        {a.started_at ? (
          <span className="text-[11px] font-semibold" style={{ color: "var(--color-ontrack)" }}>
            進行中 第 {dayN} 天
          </span>
        ) : (
          <button
            type="button"
            onClick={() =>
              start.mutate(a.id, {
                onSuccess: () => toast.success("已開始", ["當日工作結束記得回報完成量"]),
                onError: (e) =>
                  toast.error(e instanceof ApiError ? e.body.detail ?? "操作失敗" : "操作失敗"),
              })
            }
            className="rounded-lg bg-stage-2 px-2.5 py-1 text-xs font-bold text-white transition-base hover:opacity-90"
          >
            ▶ 開始
          </button>
        )}
        <div className="flex items-center gap-1">
          <input
            type="number"
            inputMode="decimal"
            min={0}
            max={assignedNum}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            aria-label={`${a.task_name} ${a.status} 的完成量`}
            className="w-16 rounded-lg border border-line bg-page px-2 py-1.5 text-right tabular-nums text-ink"
          />
          <span className="tabular-nums text-ink-3">/{assignedNum}</span>
        </div>
      </div>
    </Card>
  );
}

function Group({
  title,
  units,
  onOpen,
  urgent = false,
  muted = false,
}: {
  title: string;
  units: FlowUnit[];
  onOpen: (id: number) => void;
  urgent?: boolean;
  muted?: boolean;
}) {
  return (
    <section>
      <SectionTitle>
        <SourceTag kind="project" />
        <span style={urgent ? { color: "var(--color-delayed)" } : undefined}>
          {title}
          <span className="ml-1.5 text-xs font-normal text-ink-3">{units.length} 項</span>
        </span>
      </SectionTitle>
      <ul className="space-y-2">
        {units.map((unit) => (
          <TaskCard key={unit.id} unit={unit} onOpen={() => onOpen(unit.id)} muted={muted} />
        ))}
      </ul>
    </section>
  );
}

function TaskCard({
  unit,
  onOpen,
  muted,
}: {
  unit: FlowUnit;
  onOpen: () => void;
  muted: boolean;
}) {
  const transition = useFlowTransition();
  const toast = useToast();

  function move(toState: string) {
    transition.mutate(
      { id: unit.id, to_state: toState },
      {
        onSuccess: (saved) => toast.success(`${saved.flow_name} → ${saved.state_label}`),
        onError: (err) =>
          toast.error(err instanceof ApiError ? err.body.detail ?? "操作失敗" : "操作失敗"),
      },
    );
  }

  return (
    <Card as="li" className={`flex items-center gap-1.5 p-3 ${muted ? "opacity-70" : ""}`}>
      {/* 主區塊開明細；動作按鈕在外面，不做巢狀按鈕 */}
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-bold text-ink">
              {unit.flow_code} {unit.flow_name}
            </span>
            <FlowStateBadge state={unit.state} overdue={unit.is_overdue} />
          </span>
          <span className="mt-0.5 block truncate text-xs text-ink-3">
            {unit.project_name}
            {unit.plan_end && (
              <span
                className="ml-2"
                style={unit.is_overdue ? { color: "var(--color-delayed)", fontWeight: 600 } : undefined}
              >
                預計 {unit.plan_end} 完成
              </span>
            )}
          </span>
          {unit.description && (
            <span className="mt-1 line-clamp-2 block text-xs leading-snug text-ink-2">
              {unit.description}
            </span>
          )}
        </span>
        <ChevronRight size={15} className="shrink-0 text-ink-3" />
      </button>

      {unit.state === "todo" && (
        <Button variant="primary" onClick={() => move("doing")} loading={transition.isPending}>
          <Play size={13} />
          開始
        </Button>
      )}
      {unit.state === "doing" && !unit.is_batch_driven && (
        <Button variant="primary" onClick={() => move("done")} loading={transition.isPending}>
          <CheckCircle2 size={13} />
          完成
        </Button>
      )}
    </Card>
  );
}
