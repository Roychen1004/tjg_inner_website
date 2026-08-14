/**
 * 專案
 *
 * 回答的問題：**這個案子進行到哪**。
 *
 * 一頁搞定：清單點開就在同一頁展開明細（主線階段、追蹤單元、請款）。
 * 不做「清單頁 → 明細頁 → 子頁」的三層導航——那會讓人迷路。
 */
import { ArrowLeft, ArrowRight, ChevronDown, Pencil, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { ApiError } from "@/api/client";
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
  useAdvanceProject,
  useOptions,
  useProject,
  useProjectSummary,
  useProjects,
  useTrackingUnits,
} from "@/api/hooks";
import type { Milestone, ProjectDetail, ProjectRow, TrackingCard } from "@/api/types";
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
  StageTrack,
  StatusBadge,
} from "@/components/ui";
import { useToast } from "@/components/ui/Toast";

export default function Projects() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: options } = useOptions();
  const { data: user } = useCurrentUser();
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const type = searchParams.get("type") ?? "";
  const openId = searchParams.get("open");

  const { data, isLoading, error, refetch } = useProjects({ q: q || undefined, type: type || undefined });

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
          value={type}
          onChange={(v) => {
            const next = new URLSearchParams(searchParams);
            if (v) next.set("type", v);
            else next.delete("type");
            setSearchParams(next, { replace: true });
          }}
          options={options?.project_type ?? []}
          placeholder="全部類型"
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
          hint="預設只顯示進行中的案子。已結案的請用篩選查詢"
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

  return (
    <Card
      ref={ref}
      className={open ? "scroll-mt-4 ring-2 ring-stage-2" : "scroll-mt-4"}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start gap-3 p-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-ink">{project.name}</span>
            <StatusBadge status={project.status} size="xs" />
            <span className="rounded bg-page px-1.5 py-0.5 text-[11px] text-ink-2">
              {project.project_type_label}
            </span>
            {project.is_overdue && (
              <span
                className="rounded px-1.5 py-0.5 text-[11px] font-semibold"
                style={{ background: "var(--color-delayed-bg)", color: "var(--color-delayed)" }}
              >
                逾期
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-ink-3">
            {project.code} · {project.customer_name} · 負責人 {project.owner_name || "未指派"}
          </p>

          <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
            <StageTrack
              current={project.main_stage_seq}
              total={project.main_stage_total}
              name={project.main_stage_name}
            />
            {project.collection_rate !== null && (
              <ProgressBar
                value={project.collection_rate}
                label="收款進度"
                compact
                color="var(--color-ontrack)"
              />
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-2">
            <span>{project.unit_count} 個追蹤單元</span>
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
        <ChevronDown
          size={18}
          className={`mt-1 shrink-0 text-ink-3 transition-base ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && <ProjectDetailPanel id={project.id} />}
    </Card>
  );
}

// ── 展開後的明細 ───────────────────────────────────────────────────
function ProjectDetailPanel({ id }: { id: number }) {
  const { data: detail } = useProject(id);
  const { data: summary } = useProjectSummary(id);
  const { data: units } = useTrackingUnits({ project: id, page_size: 100 });
  const [selected, setSelected] = useState<TrackingCard | null>(null);
  const [addingUnit, setAddingUnit] = useState(false);
  const [editing, setEditing] = useState(false);

  if (!detail) return <Spinner label="" />;

  return (
    <div className="border-t border-line px-3 py-3">
      <MainStageControl detail={detail} />

      {summary && (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="追蹤單元" value={summary.unit_counts.total} />
          <Stat
            label="需關注"
            value={summary.unit_counts.atrisk + summary.unit_counts.delayed}
            tone={summary.unit_counts.delayed ? "bad" : "warn"}
          />
          <Stat label="平均完成度" value={`${summary.avg_completion}%`} />
          <Stat label="應收款" value={detail.milestones.length} />
        </div>
      )}

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

      <MilestoneSection detail={detail} />

      <ProjectPnl project={detail} />

      {/* 合約、圖說、時程表都是「這個案子」層級的東西 */}
      <div className="mt-4">
        <AttachmentSection target="project" id={detail.id} defaultCategory="contract" />
      </div>

      <ChangeOrderSection project={detail} />

      <SubcontractSection project={detail} />

      <div className="mt-4">
        <SectionTitle
          action={
            <div className="flex gap-2">
              {detail.can_edit && (
                <Button variant="ghost" onClick={() => setEditing(true)}>
                  <Pencil size={13} />
                  編輯專案
                </Button>
              )}
              <Button variant="primary" onClick={() => setAddingUnit(true)}>
                <Plus size={13} />
                新增追蹤單元
              </Button>
            </div>
          }
        >
          追蹤單元
        </SectionTitle>
        {!units?.results.length ? (
          <EmptyState
            title="這個案子還沒有追蹤單元"
            hint={
              detail.project_type === "civil"
                ? "土建案的追蹤單元是「工項」，走 5 階段流程"
                : "鋼構案的追蹤單元是「構件批次」，走 9 階段流程"
            }
            action={
              <Button variant="primary" onClick={() => setAddingUnit(true)}>
                <Plus size={14} />
                新增第一個追蹤單元
              </Button>
            }
          />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {units.results.map((unit) => (
              <TrackingCardView
                key={unit.id}
                unit={unit}
                onOpen={setSelected}
                showProject={false}
              />
            ))}
          </div>
        )}
      </div>

      <UnitPanel unit={selected} onClose={() => setSelected(null)} />
      <UnitForm
        open={addingUnit}
        onClose={() => setAddingUnit(false)}
        defaultProject={detail.id}
      />
      <ProjectForm open={editing} onClose={() => setEditing(false)} project={detail} />
    </div>
  );
}

function MainStageControl({ detail }: { detail: NonNullable<ReturnType<typeof useProject>["data"]> }) {
  const advance = useAdvanceProject(detail.id);
  const toast = useToast();
  const error = advance.error instanceof ApiError ? advance.error : null;
  const needsConfirm = error?.needsConfirmation;

  function go(direction: "forward" | "backward", confirmed = false) {
    advance.mutate(
      { direction, confirmed },
      {
        onSuccess: (result) => {
          toast.show(`${detail.name} → ${result.project.main_stage_name}`, {
            severity: result.warnings.length ? "warn" : "good",
            lines: result.warnings,
          });
        },
      },
    );
  }

  return (
    <div>
      <SectionTitle>專案主線</SectionTitle>
      <ol className="scroll-x flex gap-1 pb-1">
        {detail.main_stages.map((stage) => {
          const done = stage.seq < detail.main_stage_seq;
          const current = stage.seq === detail.main_stage_seq;
          return (
            <li
              key={stage.id}
              aria-current={current ? "step" : undefined}
              className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold"
              style={{
                background: current ? stage.color : done ? "var(--color-page)" : "transparent",
                color: current ? "#fff" : done ? "var(--color-ink-2)" : "var(--color-ink-3)",
                border: current ? "none" : "1px solid var(--color-line)",
              }}
            >
              {stage.name}
            </li>
          );
        })}
      </ol>

      {(detail.can_advance || detail.can_rollback) && (
        <div className="mt-2 flex gap-2">
          {detail.can_rollback && (
            <Button onClick={() => go("backward")} loading={advance.isPending}>
              <ArrowLeft size={14} />
              退回上一階段
            </Button>
          )}
          {detail.can_advance && (
            <Button variant="primary" onClick={() => go("forward")} loading={advance.isPending}>
              <ArrowRight size={14} />
              推進下一階段
            </Button>
          )}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mt-2 rounded-lg px-3 py-2 text-xs"
          style={{
            background: needsConfirm ? "var(--color-atrisk-bg)" : "var(--color-delayed-bg)",
            color: needsConfirm ? "var(--color-atrisk)" : "var(--color-delayed)",
          }}
        >
          <p>{error.body.detail}</p>
          {needsConfirm && (
            <Button
              variant="danger"
              className="mt-2"
              onClick={() => go("forward", true)}
              loading={advance.isPending}
            >
              仍要結案
            </Button>
          )}
        </div>
      )}
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
        <p className="rounded-lg bg-page px-3 py-2 text-[11px] leading-relaxed text-ink-2">
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
                  <span className="rounded-full bg-card px-2 py-0.5 text-[11px] font-semibold text-ink-2">
                    {m.state_label}
                  </span>
                  <span className="ml-auto font-semibold tabular-nums text-ink">
                    <Money value={m.amount} compact />
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-ink-3">
                  {m.condition && <span>{m.condition}</span>}
                  {m.state === "pending" && <span>預計請款 {m.expected_date ?? "未定"}</span>}
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
            <p className="mt-1.5 text-[11px]" style={{ color: "var(--color-atrisk)" }}>
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
      <p className="text-[11px] text-ink-3">{label}</p>
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
