/**
 * 專案
 *
 * 回答的問題：**這個案子進行到哪**。
 *
 * 一頁搞定：清單點開就在同一頁展開明細（主線階段、追蹤單元、請款）。
 * 不做「清單頁 → 明細頁 → 子頁」的三層導航——那會讓人迷路。
 */
import { ArrowLeft, ArrowRight, ChevronDown, Pencil, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { ApiError, api } from "@/api/client";
import { useCurrentUser } from "@/api/hooks/useAuth";
import SetupCheck from "@/components/billing/SetupCheck";
import ChangeOrderSection from "@/components/forms/ChangeOrderForm";
import ProjectForm from "@/components/forms/ProjectForm";
import UnitForm from "@/components/forms/UnitForm";
import {
  useAdvanceProject,
  useMilestones,
  useOptions,
  useProject,
  useProjectSummary,
  useProjects,
  useTrackingUnits,
} from "@/api/hooks";
import type { ProjectDetail, ProjectRow, TrackingCard } from "@/api/types";
import TrackingCardView from "@/components/tracking/TrackingCard";
import UnitPanel from "@/components/tracking/UnitPanel";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  inputClass,
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
import { phaseName } from "@/lib/naming";
import { useMutation, useQueryClient } from "@tanstack/react-query";

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
        {user?.permissions.create_project && (
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
  const { data: milestones } = useMilestones({ project: id });
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
          <Stat label="待簽收" value={summary.awaiting_signoff.length} tone="warn" />
        </div>
      )}

      {summary?.billing && (
        <div className="mt-4">
          <SectionTitle>請款進度</SectionTitle>
          {/* 請款沒設定好時，這裡會直接說缺什麼——
              比讓人到請款頁才發現「怎麼都沒東西」好 */}
          <SetupCheck projectId={id} />
          <Card className="p-3">
            <ProgressBar
              value={summary.billing.collection_rate}
              label="收款率"
              color="var(--color-ontrack)"
            />
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
              <MoneyStat label="有效合約" value={summary.billing.contract_amount} />
              <MoneyStat label="可請款" value={summary.billing.claimable} />
              <MoneyStat label="已請款" value={summary.billing.claimed} />
              <MoneyStat label="已收款" value={summary.billing.received} />
            </dl>
          </Card>
        </div>
      )}

      <PhaseManager project={detail} />

      <ChangeOrderSection project={detail} />

      {milestones && milestones.results.length > 0 && (
        <div className="mt-4">
          <SectionTitle>請款里程碑</SectionTitle>
          <ul className="space-y-1.5">
            {milestones.results.map((m) => (
              <li key={m.id} className="rounded-lg bg-page p-2.5 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-ink">
                    {m.seq}. {m.label}
                  </span>
                  <span className="rounded-full bg-card px-2 py-0.5 text-[11px] font-semibold text-ink-2">
                    {m.state_label}
                  </span>
                </div>
                <p className="mt-1 text-ink-2">{m.trigger_desc}</p>
                <p className="mt-0.5 text-ink-3">
                  {m.trigger_label} · {m.progress.text}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

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
 * 期別（標段）管理
 *
 * ⚠️ 期別是**工程的分期**，不是「分期付款」——雖然兩者常常對得起來。
 *
 * 它做兩件事：把追蹤單元分組、決定簽收時觸發哪一筆請款里程碑。
 * 合約寫「第一期構件全數簽收後請款 40%」時，
 * 系統要知道「哪些批次算第一期」——靠的就是這個。
 */
function PhaseManager({ project }: { project: ProjectDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  const nextSeq = Math.max(0, ...project.phases.map((p) => p.seq)) + 1;
  const autoName = phaseName(nextSeq);

  const create = useMutation({
    // 沒開自訂就用「第N期」——九成的案子就是這樣命名，
    // 為了打三個字開一個輸入框是多餘的
    mutationFn: (customName?: string) =>
      api.post("/project-phases", {
        project: project.id,
        seq: nextSeq,
        name: (customName ?? autoName).trim(),
      }),
    onSuccess: (_d, customName) => {
      qc.invalidateQueries({ queryKey: ["project"] });
      toast.success(`已新增期別「${(customName ?? autoName).trim()}」`);
      setName("");
      setAdding(false);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.body.detail : "新增失敗"),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/project-phases/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project"] });
      toast.success("期別已刪除");
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.body.detail : "刪除失敗"),
  });

  if (!project.can_edit && project.phases.length === 0) return null;

  return (
    <div className="mt-4">
      <SectionTitle
        action={
          project.can_edit && !adding ? (
            <div className="flex gap-1">
              <Button variant="primary" onClick={() => create.mutate(undefined)} loading={create.isPending}>
                <Plus size={13} />
                新增{autoName}
              </Button>
              <Button variant="ghost" onClick={() => setAdding(true)}>
                自訂…
              </Button>
            </div>
          ) : undefined
        }
      >
        期別（標段）
      </SectionTitle>

      {project.phases.length === 0 && !adding ? (
        <p className="rounded-lg bg-page px-3 py-2 text-[11px] leading-relaxed text-ink-2">
          這個案子沒有分期，請款里程碑會以<strong>全案</strong>為範圍。
          若合約是分期請款（第一期／第二期…），在這裡建立期別，
          追蹤單元與里程碑就能分別掛到各期。
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {project.phases.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-2 rounded-lg bg-page px-2.5 py-1.5 text-xs"
            >
              <span className="font-semibold text-ink">{p.name}</span>
              <span className="text-ink-3">{p.unit_count ?? 0} 個單元</span>
              {project.can_edit && (
                <button
                  type="button"
                  onClick={() => remove.mutate(p.id)}
                  aria-label={`刪除 ${p.name}`}
                  className="h-6 min-h-0 rounded p-0.5 text-ink-3 hover:text-[var(--color-delayed)]"
                >
                  <X size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <div className="mt-2 flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`不填就用「${autoName}」。也可以打「A標段」之類的`}
            autoFocus
            className={inputClass}
          />
          <Button
            variant="primary"
            onClick={() => create.mutate(name.trim() || undefined)}
            loading={create.isPending}
          >
            新增
          </Button>
          <Button
            onClick={() => {
              setAdding(false);
              setName("");
            }}
          >
            取消
          </Button>
        </div>
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
