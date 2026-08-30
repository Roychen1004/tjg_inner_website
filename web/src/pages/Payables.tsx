/**
 * 應付（金流分頁的第二個子頁）
 *
 * 回答的問題：**錢什麼時候要出去、出去多少。**
 *
 * 版面刻意跟「應收」長得一樣——同樣的四張卡片、同樣的狀態徽章、
 * 同樣的「變更狀態」按鈕。會計看得懂一邊就看得懂另一邊，少學一套東西。
 *
 * 兩個子頁的差別只有方向：
 *   應收  未到 → 可請款 → 已請款 → 已收款   錢進來
 *   應付  待計價 → 已核可 → 已付款          錢出去
 */
import { AlertTriangle, Banknote, ExternalLink, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "@/api/client";
import {
  useOptions,
  usePayableSummary,
  usePayables,
  useTransitionPayable,
} from "@/api/hooks";
import { useCurrentUser } from "@/api/hooks/useAuth";
import type { Payable } from "@/api/types";
import PayableForm from "@/components/forms/PayableForm";
import { Button, Card, DateInput, EmptyState, ErrorState, Field, FormErrors, inputClass, KpiCard, Modal, Money, SearchInput, Select, Spinner } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { fmtWan } from "@/lib/format";
import { useStickyParams } from "@/lib/stickyParams";

const STATE_STYLE: Record<string, { color: string; bg: string }> = {
  pending: { color: "var(--color-ink-2)", bg: "var(--color-page)" },
  approved: { color: "var(--color-atrisk)", bg: "var(--color-atrisk-bg)" },
  paid: { color: "var(--color-ontrack)", bg: "var(--color-ontrack-bg)" },
};

const KEYS = ["project", "state"];

export default function PayablesBody() {
  const { data: user } = useCurrentUser();
  const { data: options } = useOptions();
  const [searchParams, setSearchParams] = useStickyParams("payables.filters", KEYS);
  const project = searchParams.get("project") ?? "";
  const state = searchParams.get("state") ?? "";
  const [q, setQ] = useState("");
  const [transitioning, setTransitioning] = useState<Payable | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Payable | null>(null);

  const setParam = (name: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(name, value);
    else next.delete(name);
    setSearchParams(next, { replace: true });
  };

  const { data: summary } = usePayableSummary();
  const { data, isLoading, error, refetch } = usePayables({
    project: project || undefined,
    state: state || undefined,
    q: q || undefined,
    page_size: 50,
  });
  const canCreate = Boolean(user?.permissions.edit_payable);

  const rows = data?.results ?? [];
  const overdue = summary?.overdue;

  // D51：從現金流時間軸／流程卡片跳過來的那一筆——
  // 先清掉會把它濾掉的舊篩選，載入後框出並捲到眼前
  const highlightId = searchParams.get("payable");
  useEffect(() => {
    if (!highlightId) return;
    const next = new URLSearchParams(window.location.search);
    if (next.get("project") || next.get("state")) {
      next.delete("project");
      next.delete("state");
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightId]);
  useEffect(() => {
    if (!highlightId || isLoading) return;
    document
      .getElementById(`payable-${highlightId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightId, isLoading, rows.length]);

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <KpiCard label="待計價" value={fmtWan(summary?.pending)} unit="萬" />
        <KpiCard
          label="已核可待付"
          value={fmtWan(summary?.approved)}
          unit="萬"
          status={Number(summary?.approved ?? 0) > 0 ? "warn" : "neutral"}
          detail="這些是確定要付出去的"
        />
        <KpiCard label="已付款" value={fmtWan(summary?.paid)} unit="萬" />
        <KpiCard
          label="逾期未付"
          value={overdue?.count ?? 0}
          unit="筆"
          status={overdue?.count ? "bad" : "good"}
          detail={overdue?.count ? `合計 ${Number(overdue.amount).toLocaleString("zh-TW")} 元` : "沒有逾期"}
        />
      </section>

      <section className="flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="搜尋項目、廠商、發票號碼…" />
        <Select
          value={project}
          onChange={(v) => setParam("project", v)}
          options={(options?.projects ?? []).map((p) => ({ value: p.id, label: p.name }))}
          placeholder="全部專案"
        />
        <Select
          value={state}
          onChange={(v) => setParam("state", v)}
          options={options?.payable_state ?? []}
          placeholder="全部狀態"
        />
        {canCreate && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={15} />
            登錄計價
          </Button>
        )}
      </section>

      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="沒有符合條件的應付款項"
          hint={
            canCreate
              ? "包商送計價單過來、材料商開發票過來，就在這裡登錄一筆。登錄之後，這筆錢會出現在現金流預測裡"
              : "換個篩選條件看看"
          }
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <Row
              key={row.id}
              row={row}
              highlighted={highlightId === String(row.id)}
              onTransition={() => setTransitioning(row)}
              onEdit={canCreate ? () => setEditing(row) : undefined}
            />
          ))}
        </ul>
      )}

      {transitioning && (
        <TransitionModal payable={transitioning} onClose={() => setTransitioning(null)} />
      )}
      {creating && <PayableForm onClose={() => setCreating(false)} />}
      {editing && <PayableForm payable={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function Row({
  row,
  highlighted = false,
  onTransition,
  onEdit,
}: {
  row: Payable;
  /** D51：從別處跳過來的那一筆——藍框標示 */
  highlighted?: boolean;
  onTransition: () => void;
  onEdit?: () => void;
}) {
  const style = STATE_STYLE[row.state] ?? STATE_STYLE.pending;
  return (
    // 整列可點（D47）：點哪裡都開明細編輯；右側按鈕區自己攔截點擊
    <Card
      as="li"
      id={`payable-${row.id}`}
      className={`p-3 ${onEdit ? "cursor-pointer transition-base hover:ring-stage-2" : ""}`}
      style={highlighted ? { boxShadow: "0 0 0 3px var(--color-stage-2)" } : undefined}
      onClick={onEdit}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className="rounded-full px-2 py-0.5 text-xs font-semibold"
              style={{ color: style.color, background: style.bg }}
            >
              {row.state_label}
            </span>
            <p className="truncate text-sm font-semibold text-ink">{row.title}</p>
          </div>
          <p className="mt-0.5 text-xs text-ink-3">
            {row.vendor_name} · {row.project_name} · {row.category_label}
            {row.subcontract_code && ` · ${row.subcontract_code}`}
            {row.flow_unit_name && (
              <span
                className="ml-1 rounded bg-page px-1.5 py-0.5 font-semibold text-ink-2"
                title="這筆錢掛在哪個流程上（在流程卡片或這裡登錄時掛的）"
              >
                流程：{row.flow_unit_name}
              </span>
            )}
          </p>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-2">
            <span>
              計價 {row.billing_date ?? "—"}
            </span>
            <span className={row.is_overdue ? "font-semibold" : ""} style={row.is_overdue ? { color: "var(--color-delayed)" } : undefined}>
              {row.is_overdue && <AlertTriangle size={11} className="mr-0.5 inline" />}
              預計付款 {row.due_date ?? "未定"}
            </span>
            <span>{row.method_label}</span>
          </div>
          {/* 支票的話一定要說清楚錢什麼時候真的出去 */}
          {row.cash_date_note && (
            <p className="mt-1 text-xs leading-snug text-ink-3">{row.cash_date_note}</p>
          )}
        </div>

        <div
          className="shrink-0 text-right"
          onClick={(e) => e.stopPropagation()}
          role="presentation"
        >
          <p className="text-base font-bold text-ink">
            <Money value={row.payable_amount} />
          </p>
          {Number(row.retention_amount) > 0 && (
            <p className="text-xs text-ink-3">
              扣保 <Money value={row.retention_amount} compact />
            </p>
          )}
          <div className="mt-2 flex items-center justify-end gap-1.5">
            {/* 跳去掛著的流程卡片（D47） */}
            {row.flow_unit && (
              <Link
                to={`/tracking?view=flow&unit=${row.flow_unit}`}
                title={`前往流程「${row.flow_unit_name}」的卡片`}
                className="flex h-9 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-ink-2 ring-1 ring-line transition-base hover:bg-page"
              >
                <ExternalLink size={13} />
                流程
              </Link>
            )}
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

function TransitionModal({ payable, onClose }: { payable: Payable; onClose: () => void }) {
  const { data: options } = useOptions();
  const transition = useTransitionPayable();
  const toast = useToast();
  const [error, setError] = useState<ApiError | null>(null);

  const [target, setTarget] = useState(payable.next_states[0]?.value ?? "");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState(payable.payment_method);
  const [checkDue, setCheckDue] = useState(payable.check_due_date ?? "");
  const [checkNo, setCheckNo] = useState(payable.check_no);
  const [reason, setReason] = useState("");

  const ORDER: Record<string, number> = { pending: 0, approved: 1, paid: 2 };
  const isBackward = ORDER[target] < ORDER[payable.state];
  const isPaying = target === "paid";
  const needsCheckDate = isPaying && method === "check" && !checkDue;

  function submit() {
    setError(null);
    transition.mutate(
      {
        id: payable.id,
        to_state: target,
        date: isPaying ? date : undefined,
        payment_method: isPaying ? method : undefined,
        check_due_date: isPaying && method === "check" ? checkDue : undefined,
        check_no: isPaying && method === "check" ? checkNo : undefined,
        reason: isBackward ? reason : undefined,
      },
      {
        onSuccess: (result) => {
          toast.success(`已轉為「${result.state_label}」`);
          onClose();
        },
        onError: (e) => {
          if (e instanceof ApiError) setError(e);
          else toast.error("狀態變更失敗");
        },
      },
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`${payable.vendor_name}·${payable.title}`}
      footer={
        <>
          <Button className="flex-1" onClick={onClose}>
            取消
          </Button>
          <Button
            variant={isBackward ? "danger" : "primary"}
            className="flex-1"
            loading={transition.isPending}
            disabled={!target || (isBackward && !reason.trim())}
            onClick={submit}
          >
            確定
          </Button>
        </>
      }
    >
      <FormErrors error={error} handled={["reason", "check_due_date", "date"]} />

      <p className="mb-3 text-sm text-ink-2">
        實付金額 <Money value={payable.payable_amount} className="font-bold text-ink" /> 元
      </p>

      <Field label="轉為" required>
        <select value={target} onChange={(e) => setTarget(e.target.value)} className={inputClass}>
          {payable.next_states.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>

      {isPaying && (
        <>
          <Field label="實際付款日" required>
            <DateInput value={date} onChange={setDate} />
          </Field>
          <Field label="付款方式">
            <select value={method} onChange={(e) => setMethod(e.target.value)} className={inputClass}>
              {(options?.payment_method ?? []).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          {method === "check" && (
            <div
              className="mb-3 rounded-lg px-3 py-2.5"
              style={{ background: "var(--color-atrisk-bg)" }}
            >
              <p
                className="mb-2 text-xs font-semibold leading-relaxed"
                style={{ color: "var(--color-atrisk)" }}
              >
                開了票不等於錢出去了。填上票期，現金流才會把這筆算在正確的那一週。
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="支票到期日" required>
                  <DateInput value={checkDue} onChange={setCheckDue} />
                </Field>
                <Field label="票號">
                  <input value={checkNo} onChange={(e) => setCheckNo(e.target.value)} className={inputClass} />
                </Field>
              </div>
            </div>
          )}
        </>
      )}

      {isBackward && (
        <Field label="退回原因" required hint="錢的狀態被改過而沒人知道，是查帳時最麻煩的事">
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className={inputClass} />
        </Field>
      )}

      {needsCheckDate && (
        <p className="text-xs text-ink-3">支票沒填票期也能存，但現金流會用開票日估算。</p>
      )}
    </Modal>
  );
}
