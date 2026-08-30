/**
 * 專案
 *
 * 回答的問題：**這個案子進行到哪**。
 *
 * 卡片上就有迷你甘特（五大階段）——不用點開就看得出排到哪、做到哪、有沒有落後。
 * 點開在同一頁展開明細（流程排程表、批次、請款）。
 * 不做「清單頁 → 明細頁 → 子頁」的三層導航——那會讓人迷路。
 */
import { Check, ChevronDown, FileSpreadsheet, Pencil, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { API_BASE } from "@/api/client";
import { useCurrentUser } from "@/api/hooks/useAuth";
import AttachmentSection from "@/components/attachments/AttachmentSection";
import MilestoneTransitionModal from "@/components/billing/MilestoneTransitionModal";
import ChangeOrderSection from "@/components/forms/ChangeOrderForm";
import SubcontractSection from "@/components/forms/SubcontractForm";
import ProjectPnl from "@/components/projects/ProjectPnl";
import MilestoneForm from "@/components/forms/MilestoneForm";
import ProjectForm from "@/components/forms/ProjectForm";
import UnitForm from "@/components/forms/UnitForm";
import {
  useOptions,
  useProject,
  useProjectSummary,
  useProjects,
  useTrackingUnits,
} from "@/api/hooks";
import type { Milestone, ProjectDetail, ProjectRow, TrackingCard } from "@/api/types";
import FlowSection from "@/components/tracking/FlowSection";
import MiniGantt from "@/components/tracking/MiniGantt";
import TrackingCardView from "@/components/tracking/TrackingCard";
import UnitPanel from "@/components/tracking/UnitPanel";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Money,
  ProgressBar,
  SearchInput,
  SectionTitle,
  Select,
  Spinner,
  StatusBadge,
} from "@/components/ui";

export default function Projects() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: options } = useOptions();
  const { data: user } = useCurrentUser();
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const lifecycle = searchParams.get("lifecycle") ?? "";
  const openId = searchParams.get("open");

  const { data, isLoading, error, refetch } = useProjects({
    q: q || undefined,
    lifecycle: lifecycle || undefined,
  });

  function toggle(id: number) {
    const next = new URLSearchParams(searchParams);
    if (openId === String(id)) next.delete("open");
    else next.set("open", String(id));
    setSearchParams(next, { replace: true });
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="搜尋案名、編號、客戶…" />
        <Select
          value={lifecycle}
          onChange={(v) => {
            const next = new URLSearchParams(searchParams);
            if (v) next.set("lifecycle", v);
            else next.delete("lifecycle");
            setSearchParams(next, { replace: true });
          }}
          options={options?.project_lifecycle ?? []}
          placeholder="進行中（預設）"
        />
        {user?.permissions.edit_project && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={15} />
            新增專案
          </Button>
        )}
      </div>

      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !data?.results.length ? (
        <EmptyState
          title="沒有符合條件的專案"
          hint="預設只顯示進行中的案子（含還在估價的）。未成交、暫停、已結案的用右上的篩選查"
        />
      ) : (
        <ul className="space-y-2">
          {data.results.map((project) => (
            <li key={project.id}>
              <ProjectRowView
                project={project}
                open={openId === String(project.id)}
                onToggle={() => toggle(project.id)}
              />
            </li>
          ))}
        </ul>
      )}

      <ProjectForm open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function ProjectRowView({
  project,
  open,
  onToggle,
}: {
  project: ProjectRow;
  open: boolean;
  onToggle: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // 從總覽或「需要關注」點進來時，該案可能在清單第 8 筆——
  // 展開了卻在畫面外，使用者會以為沒反應
  useEffect(() => {
    if (open) ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [open]);

  const flowTotal = project.flow_gantt.reduce((sum, g) => sum + g.total, 0);
  const flowDone = project.flow_gantt.reduce((sum, g) => sum + g.done, 0);

  return (
    <Card
      ref={ref}
      className={open ? "scroll-mt-4 ring-2 ring-stage-2" : "scroll-mt-4"}
    >
      {/* 整張卡可點展開。用 div+onClick 而不是 button：
          裡面還有「下載工期規劃」連結，互動元件不能巢在按鈕裡。
          鍵盤操作走右側的箭頭按鈕（那才是真正的 button）。 */}
      <div
        onClick={onToggle}
        className="flex w-full cursor-pointer items-start gap-3 p-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-ink">{project.name}</span>
            <StatusBadge status={project.status} size="xs" />
            {project.lifecycle !== "active" && (
              <span className="rounded bg-page px-1.5 py-0.5 text-xs font-semibold text-ink-2">
                {project.lifecycle_label}
              </span>
            )}
            {project.is_overdue && (
              <span
                className="rounded px-1.5 py-0.5 text-xs font-semibold"
                style={{ background: "var(--color-delayed-bg)", color: "var(--color-delayed)" }}
              >
                逾期
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-ink-3">
            {project.code} · {project.customer_name} · 負責人 {project.owner_name || "未指派"}
          </p>

          {/* ★ 迷你甘特：不用點開就看得出這個案子排到哪、做到哪 */}
          <div className="mt-2.5 grid gap-3 sm:grid-cols-[1fr_12rem]">
            <MiniGantt bars={project.flow_gantt} />
            {(project.collection_rate !== null || flowTotal > 0) && (
              <div className="self-center">
                {project.collection_rate !== null && (
                  <ProgressBar
                    value={project.collection_rate}
                    label="收款進度"
                    compact
                    color="var(--color-ontrack)"
                  />
                )}
                {flowTotal > 0 && (
                  // 業主版甘特 Excel：簽約前給業主看的工期規劃（無進度/狀態/負責人）
                  <a
                    href={`${API_BASE}/projects/${project.id}/gantt-xlsx?variant=plan`}
                    download
                    title="簽約前給業主：只有流程與工期，沒有進度、狀態、負責人"
                    onClick={(e) => e.stopPropagation()}
                    className="mt-1.5 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-xs font-semibold text-ink-2 transition-base hover:bg-page hover:text-ink"
                  >
                    <FileSpreadsheet size={12} />
                    下載工期規劃（業主版）
                  </a>
                )}
              </div>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-2">
            {flowTotal > 0 && (
              <span>
                流程 {flowDone}/{flowTotal}
              </span>
            )}
            {project.unit_count > 0 && <span>{project.unit_count} 張批次</span>}
            {project.attention_count > 0 && (
              <span style={{ color: "var(--color-atrisk)" }}>
                {project.attention_count} 個需關注
              </span>
            )}
            <span>
              合約 <Money value={project.contract_amount} compact />
            </span>
            {project.due_date && (
              <span>
                完工 {project.due_date}
                {project.days_left !== null && project.days_left >= 0 && ` (剩 ${project.days_left} 天)`}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? "收合明細" : "展開明細"}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className="mt-1 shrink-0 rounded-md p-0.5 text-ink-3 transition-base hover:bg-page"
        >
          <ChevronDown
            size={18}
            className={`transition-base ${open ? "rotate-180" : ""}`}
          />
        </button>
      </div>

      {open && <ProjectDetailPanel id={project.id} />}
    </Card>
  );
}

// ── 展開後的明細 ───────────────────────────────────────────────────
function ProjectDetailPanel({ id }: { id: number }) {
  const { data: detail } = useProject(id);
  const { data: summary } = useProjectSummary(id);

  if (!detail) return <Spinner label="" />;

  const flows = detail.flow_units.filter((u) => u.state !== "na");
  const overdueFlows = flows.filter((u) => u.is_overdue).length;
  const unassigned = flows.filter((u) => u.state === "doing" && !u.assignee).length;

  return (
    <div className="border-t border-line px-3 py-3">
      <MainStageControl detail={detail} />

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="流程進度"
          value={`${flows.filter((u) => u.state === "done").length}/${flows.length}`}
        />
        <Stat label="逾期流程" value={overdueFlows} tone="bad" />
        <Stat label="進行中沒負責人" value={unassigned} tone="warn" />
        <Stat label="應收款" value={detail.milestones.length} />
      </div>

      {summary?.billing && (
        <div className="mt-4">
          <SectionTitle>收款進度</SectionTitle>
          <Card className="p-3">
            <ProgressBar
              value={summary.billing.collection_rate}
              label="收款率"
              color="var(--color-ontrack)"
            />
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
              <MoneyStat label="有效合約" value={summary.billing.contract_amount} />
              <MoneyStat label="可請款" value={summary.billing.claimable} />
              <MoneyStat label="已請款" value={summary.billing.invoiced} />
              <MoneyStat label="已收款" value={summary.billing.received} />
            </dl>
          </Card>
        </div>
      )}

      {/* ★ 主角：這個案子勾的流程與排程 */}
      <FlowSection detail={detail} />

      <BatchSection detail={detail} />

      <MilestoneSection detail={detail} />

      <ProjectPnl project={detail} />

      {/* 合約、圖說、時程表都是「這個案子」層級的東西 */}
      <div className="mt-4">
        <AttachmentSection target="project" id={detail.id} defaultCategory="contract" />
      </div>

      <ChangeOrderSection project={detail} />

      <SubcontractSection project={detail} />

      <EditProjectButton detail={detail} />
    </div>
  );
}

/** 構件批次（階段 4 的實體單位，過站自動彙總回流程） */
function BatchSection({ detail }: { detail: ProjectDetail }) {
  const { data: user } = useCurrentUser();
  const { data: units } = useTrackingUnits({ project: detail.id, page_size: 100 });
  const [selected, setSelected] = useState<TrackingCard | null>(null);
  const [adding, setAdding] = useState(false);

  const rows = units?.results ?? [];
  const canEdit = Boolean(user?.permissions.edit_tracking);
  // 沒批次也沒權限新增的話，整個區塊不出現——不佔版面
  if (rows.length === 0 && !canEdit) return null;

  return (
    <div className="mt-4">
      <SectionTitle
        action={
          canEdit ? (
            <Button variant="ghost" onClick={() => setAdding(true)}>
              <Plus size={13} />
              新增批次
            </Button>
          ) : undefined
        }
      >
        構件批次
        <span className="ml-1.5 text-xs font-normal text-ink-3">
          過站自動彙總到階段 4 的流程
        </span>
      </SectionTitle>
      {rows.length === 0 ? (
        <p className="rounded-lg bg-page px-3 py-2 text-xs leading-relaxed text-ink-2">
          還沒有批次。把構件拆成批次（如「1F鋼柱 80支」）後，
          廠內七站（待加工→…→已安裝）的推進會自動回寫流程進度。
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((unit) => (
            <TrackingCardView key={unit.id} unit={unit} onOpen={setSelected} showProject={false} />
          ))}
        </div>
      )}

      <UnitPanel unit={selected} onClose={() => setSelected(null)} />
      <UnitForm open={adding} onClose={() => setAdding(false)} defaultProject={detail.id} />
    </div>
  );
}

function EditProjectButton({ detail }: { detail: ProjectDetail }) {
  const [editing, setEditing] = useState(false);
  if (!detail.can_edit) return null;
  return (
    <div className="mt-4 flex justify-end">
      <Button variant="ghost" onClick={() => setEditing(true)}>
        <Pencil size={13} />
        編輯專案（案名、金額、狀態）
      </Button>
      <ProjectForm open={editing} onClose={() => setEditing(false)} project={detail} />
    </div>
  );
}

/**
 * 專案主線：由流程進度**自動判定**，不用手動推進（2026-08-15 改版）。
 *
 * 一個大階段亮起＝階段裡有流程開始了（進行中，或完成了一部分）；
 * 全部完成就打勾。加工還沒收尾、現場已經開工這種情況，
 * 兩個階段會同時亮——這是實際狀況，不硬選一個。
 */
function MainStageControl({ detail }: { detail: ProjectDetail }) {
  const active = detail.flow_units.filter((u) => u.state !== "na");
  if (active.length === 0) return null;

  const stages = new Map<number, { seq: number; name: string; total: number; done: number; doing: number }>();
  for (const u of active) {
    const s = stages.get(u.stage_seq) ?? {
      seq: u.stage_seq, name: u.stage_name, total: 0, done: 0, doing: 0,
    };
    s.total += 1;
    if (u.state === "done") s.done += 1;
    if (u.state === "doing") s.doing += 1;
    stages.set(u.stage_seq, s);
  }
  const rows = [...stages.values()].sort((a, b) => a.seq - b.seq);

  return (
    <div>
      <SectionTitle>專案主線</SectionTitle>
      <ol className="scroll-x flex gap-1 pb-1">
        {rows.map((stage) => {
          const done = stage.done === stage.total;
          const current = !done && (stage.doing > 0 || stage.done > 0);
          return (
            <li
              key={stage.seq}
              aria-current={current ? "step" : undefined}
              className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold"
              style={{
                background: current ? "var(--color-stage-2)" : done ? "var(--color-page)" : "transparent",
                color: current ? "#fff" : done ? "var(--color-ink-2)" : "var(--color-ink-3)",
                border: current ? "none" : "1px solid var(--color-line)",
              }}
            >
              {done && <Check size={11} aria-label="已完成" />}
              {stage.name}
              <span className="font-normal tabular-nums opacity-80">
                {stage.done}/{stage.total}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-1 text-xs text-ink-3">
        主線由流程進度自動判定：階段內有流程開始就亮起、全部完成就打勾，可能同時有兩個階段在進行。
      </p>
    </div>
  );
}

/**
 * 應收款（合約分期）
 *
 * 掛在專案明細裡——案子的錢跟案子一起看。
 * 金流→應收 是跨案總表，這裡是單案的同一份資料。
 */
function MilestoneSection({ detail }: { detail: ProjectDetail }) {
  const [transitioning, setTransitioning] = useState<Milestone | null>(null);
  const [editing, setEditing] = useState<Milestone | null>(null);
  const [adding, setAdding] = useState(false);

  if (!detail.can_view_amounts) return null;

  const rows = detail.milestones;
  const totalPct = rows.reduce((sum, m) => sum + Number(m.percentage), 0);

  return (
    <div className="mt-4">
      <SectionTitle
        action={
          detail.can_edit ? (
            <Button variant="ghost" onClick={() => setAdding(true)}>
              <Plus size={13} />
              加一期
            </Button>
          ) : undefined
        }
      >
        應收款（合約分期）
      </SectionTitle>

      {rows.length === 0 ? (
        <p className="rounded-lg bg-page px-3 py-2 text-xs leading-relaxed text-ink-2">
          還沒填合約的付款分期。點「加一期」把合約抄進來，
          每一期就會出現在金流與現金流預測裡。
        </p>
      ) : (
        <>
          <ul className="space-y-1.5">
            {rows.map((m) => (
              <li key={m.id} className="rounded-lg bg-page p-2.5 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-ink">{m.label}</span>
                  <span className="text-ink-3">{m.percentage}%</span>
                  <span className="rounded-full bg-card px-2 py-0.5 text-xs font-semibold text-ink-2">
                    {m.state_label}
                  </span>
                  <span className="ml-auto font-semibold tabular-nums text-ink">
                    <Money value={m.amount} compact />
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-3">
                  {m.condition && <span>{m.condition}</span>}
                  {m.state === "pending" && m.trigger_unit_name && (
                    <span style={{ color: "var(--color-stage-2)" }}>
                      完成「{m.trigger_unit_name}」→ 自動可請款
                    </span>
                  )}
                  {m.state === "pending" && <span>預計請款 {m.forecast_date ?? "未定"}</span>}
                  {m.state === "invoiced" && <span>預計收款 {m.due_date ?? "未定"}</span>}
                  {m.receive_date && <span>收款 {m.receive_date}</span>}
                  <span className="ml-auto flex gap-1">
                    {m.can_edit && (
                      <button
                        type="button"
                        onClick={() => setEditing(m)}
                        className="rounded px-1.5 py-0.5 font-semibold text-ink-2 hover:bg-card"
                      >
                        編輯
                      </button>
                    )}
                    {m.next_states.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setTransitioning(m)}
                        className="rounded px-1.5 py-0.5 font-semibold hover:bg-card"
                        style={{ color: "var(--color-stage-2)" }}
                      >
                        變更狀態
                      </button>
                    )}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          {Math.round(totalPct * 100) / 100 !== 100 && (
            <p className="mt-1.5 text-xs" style={{ color: "var(--color-atrisk)" }}>
              各期比例合計 {totalPct}%，不是 100%——確認是否漏了一期
            </p>
          )}
        </>
      )}

      {transitioning && (
        <MilestoneTransitionModal
          milestone={transitioning}
          onClose={() => setTransitioning(null)}
        />
      )}
      {(adding || editing) && (
        <MilestoneForm
          milestone={editing}
          projectId={detail.id}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: "warn" | "bad";
}) {
  const color =
    Number(value) > 0 && tone
      ? tone === "bad"
        ? "var(--color-delayed)"
        : "var(--color-atrisk)"
      : "var(--color-ink)";
  return (
    <div className="rounded-lg bg-page px-3 py-2">
      <p className="text-xs text-ink-3">{label}</p>
      <p className="mt-0.5 text-lg font-bold tabular-nums" style={{ color }}>
        {value}
      </p>
    </div>
  );
}

function MoneyStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-ink-3">{label}</dt>
      <dd className="font-semibold text-ink">
        <Money value={value} compact />
      </dd>
    </div>
  );
}
