/**
 * 應收（金流分頁的第一個子頁）
 *
 * 回答的問題：**錢收得回來嗎**。
 *
 * 一列＝合約的一期款，直接走完整個生命週期：
 *   未到 → 可請款 → 已請款 → 已收款
 *
 * 版面刻意跟「應付」長得一樣——同樣的四張卡片、同樣的狀態徽章、
 * 同樣的「變更狀態」按鈕。會計看得懂一邊就看得懂另一邊。
 */
import { AlertTriangle, Banknote, ExternalLink, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import {
  useBillingSummary,
  useMilestones,
  useOptions,
} from "@/api/hooks";
import { useCurrentUser } from "@/api/hooks/useAuth";
import type { Milestone } from "@/api/types";
import { AttachmentBadge } from "@/components/attachments/AttachmentSection";
import MilestoneForm from "@/components/forms/MilestoneForm";
import MilestoneTransitionModal from "@/components/billing/MilestoneTransitionModal";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  KpiCard,
  Money,
  SearchInput,
  Select,
  Spinner,
} from "@/components/ui";
import { fmtWan } from "@/lib/format";
import { useStickyParams } from "@/lib/stickyParams";

const STATE_STYLE: Record<string, { color: string; bg: string }> = {
  pending: { color: "var(--color-ink-3)", bg: "var(--color-page)" },
  claimable: { color: "var(--color-atrisk)", bg: "var(--color-atrisk-bg)" },
  invoiced: { color: "var(--color-stage-2)", bg: "var(--color-page)" },
  received: { color: "var(--color-ontrack)", bg: "var(--color-ontrack-bg)" },
};

const KEYS = ["project", "state"];

export default function Receivables() {
  const { data: options } = useOptions();
  const { data: user } = useCurrentUser();
  const [searchParams, setSearchParams] = useStickyParams("billing.filters", KEYS);
  const project = searchParams.get("project") ?? "";
  const state = searchParams.get("state") ?? "";
  const [q, setQ] = useState("");

  const setParam = (name: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(name, value);
    else next.delete(name);
    setSearchParams(next, { replace: true });
  };

  const { data: summary } = useBillingSummary();
  const { data, isLoading, error, refetch } = useMilestones({
    project: project || undefined,
    state: state || undefined,
    q: q || undefined,
    page_size: 50,
  });
  const [transitioning, setTransitioning] = useState<Milestone | null>(null);
  const [editing, setEditing] = useState<Milestone | null>(null);
  const [creating, setCreating] = useState(false);

  const rows = data?.results ?? [];
  const canEdit = Boolean(user?.permissions.edit_milestone);

  return (
    <div className="space-y-4">
      {summary && (
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <KpiCard label="未到期" value={fmtWan(summary.pending)} unit="萬" />
          <KpiCard
            label="可請款"
            value={fmtWan(summary.claimable)}
            unit="萬"
            status={summary.claimable_count ? "warn" : "neutral"}
            detail={`${summary.claimable_count} 筆待開單`}
          />
          <KpiCard label="已請款" value={fmtWan(summary.invoiced)} unit="萬" />
          <KpiCard label="已收款" value={fmtWan(summary.received)} unit="萬" status="good" />
        </section>
      )}

      {summary && summary.overdue_claimable.count > 0 && (
        <div
          className="flex items-start gap-2 rounded-xl px-3 py-2.5"
          style={{ background: "var(--color-delayed-bg)", color: "var(--color-delayed)" }}
        >
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <p className="text-xs leading-relaxed">
            有 <strong>{summary.overdue_claimable.count}</strong> 筆可請款超過 7 天還沒開單，
            合計 <Money value={summary.overdue_claimable.amount} /> 元。
            <span className="text-ink-2"> 這是最容易漏掉的錢。</span>
          </p>
        </div>
      )}

      <section className="flex flex-wrap items-center gap-2">
        {/* 跟應付一樣的搜尋欄（D48） */}
        <SearchInput value={q} onChange={setQ} placeholder="搜尋期別、請款單號、專案…" />
        <Select
          value={project}
          onChange={(v) => setParam("project", v)}
          options={(options?.projects ?? []).map((p) => ({ value: p.id, label: p.name }))}
          placeholder="全部專案"
        />
        <Select
          value={state}
          onChange={(v) => setParam("state", v)}
          options={options?.milestone_state ?? []}
          placeholder="全部狀態"
        />
        {canEdit && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={15} />
            新增一期
          </Button>
        )}
      </section>

      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="沒有符合條件的應收款"
          hint="建立專案時把合約的付款分期一起填好，各期就會出現在這裡"
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <Row
              key={row.id}
              row={row}
              onTransition={() => setTransitioning(row)}
              onEdit={canEdit ? () => setEditing(row) : undefined}
            />
          ))}
        </ul>
      )}

      {transitioning && (
        <MilestoneTransitionModal milestone={transitioning} onClose={() => setTransitioning(null)} />
      )}
      {(creating || editing) && (
        <MilestoneForm
          milestone={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function Row({
  row,
  onTransition,
  onEdit,
}: {
  row: Milestone;
  onTransition: () => void;
  onEdit?: () => void;
}) {
  const style = STATE_STYLE[row.state] ?? STATE_STYLE.pending;
  const overdue = (row.days_since_claimable ?? 0) > 7;
  return (
    // 整列可點（D47）：點哪裡都開明細編輯；右側按鈕區自己攔截點擊
    <Card
      as="li"
      className={`p-3 ${onEdit ? "cursor-pointer transition-base hover:ring-stage-2" : ""}`}
      onClick={onEdit}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
              style={{ color: style.color, background: style.bg }}
            >
              {row.state_label}
            </span>
            <p className="truncate text-sm font-semibold text-ink">{row.label}</p>
            <span className="text-[11px] text-ink-3">{row.percentage}%</span>
          </div>
          <p className="mt-0.5 text-[11px] text-ink-3">
            {row.project_name}
            {row.condition && ` · ${row.condition}`}
          </p>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-2">
            {row.state === "pending" && row.trigger_unit_name && (
              <span style={{ color: "var(--color-stage-2)" }}>
                完成「{row.trigger_unit_name}」→ 自動可請款
              </span>
            )}
            {row.state === "pending" && (
              <span>
                預計請款 {row.forecast_date ?? "未定（不會出現在現金流）"}
                {!row.expected_date && row.forecast_date && "（取自觸發流程排程）"}
              </span>
            )}
            {row.state === "claimable" && (
              <span className={overdue ? "font-semibold" : ""} style={overdue ? { color: "var(--color-delayed)" } : undefined}>
                {overdue && <AlertTriangle size={11} className="mr-0.5 inline" />}
                可請款已 {row.days_since_claimable ?? 0} 天，還沒開單
              </span>
            )}
            {row.invoice_date && (
              <span>
                請款 {row.invoice_date}
                {row.invoice_no && `（${row.invoice_no}）`}
              </span>
            )}
            {row.state === "invoiced" && <span>預計收款 {row.due_date ?? "未定"}</span>}
            {row.receive_date && <span>收款 {row.receive_date}</span>}
          </div>
        </div>

        <div
          className="shrink-0 text-right"
          onClick={(e) => e.stopPropagation()}
          role="presentation"
        >
          <p className="text-base font-bold text-ink">
            <Money value={row.amount} />
          </p>
          <div className="mt-2 flex items-center justify-end gap-1.5">
            {/* 跳去連結的流程卡片（D47） */}
            {row.trigger_unit && (
              <Link
                to={`/tracking?view=flow&unit=${row.trigger_unit}`}
                title={`前往觸發流程「${row.trigger_unit_name}」的卡片`}
                className="flex h-9 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-ink-2 ring-1 ring-line transition-base hover:bg-page"
              >
                <ExternalLink size={13} />
                流程
              </Link>
            )}
            {onEdit && (
              <Button onClick={onEdit} aria-label="編輯">
                <Pencil size={13} />
              </Button>
            )}
            {/* 發票、請款單掃描掛在這裡。點開才載入 */}
            <AttachmentBadge target="milestone" id={row.id} label={`${row.label} 的檔案`} />
            {row.next_states.length > 0 && (
              <Button variant="primary" onClick={onTransition}>
                <Banknote size={13} />
                變更狀態
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
