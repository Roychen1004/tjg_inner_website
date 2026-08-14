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
import { AlertTriangle, Banknote, Plus } from "lucide-react";
import { useState } from "react";

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
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  FormErrors,
  KpiCard,
  Modal,
  Money,
  SearchInput,
  Select,
  Spinner,
  inputClass,
} from "@/components/ui";
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
            <Row key={row.id} row={row} onTransition={() => setTransitioning(row)} />
          ))}
        </ul>
      )}

      {transitioning && (
        <TransitionModal payable={transitioning} onClose={() => setTransitioning(null)} />
      )}
      {creating && <PayableForm onClose={() => setCreating(false)} />}
    </div>
  );
}

function Row({ row, onTransition }: { row: Payable; onTransition: () => void }) {
  const style = STATE_STYLE[row.state] ?? STATE_STYLE.pending;
  return (
    <Card as="li" className="p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
              style={{ color: style.color, background: style.bg }}
            >
              {row.state_label}
            </span>
            <p className="truncate text-sm font-semibold text-ink">{row.title}</p>
          </div>
          <p className="mt-0.5 text-[11px] text-ink-3">
            {row.vendor_name} · {row.project_name} · {row.category_label}
            {row.subcontract_code && ` · ${row.subcontract_code}`}
          </p>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-2">
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
            <p className="mt-1 text-[11px] leading-snug text-ink-3">{row.cash_date_note}</p>
          )}
        </div>

        <div className="shrink-0 text-right">
          <p className="text-base font-bold text-ink">
            <Money value={row.payable_amount} />
          </p>
          <p className="text-[11px] text-ink-3">
            未稅 <Money value={row.amount} compact />
            {Number(row.retention_amount) > 0 && (
              <>
                {" · "}
                扣保 <Money value={row.retention_amount} compact />
              </>
            )}
          </p>
          {row.next_states.length > 0 && (
            <Button variant="primary" className="mt-2" onClick={onTransition}>
              <Banknote size={13} />
              變更狀態
            </Button>
          )}
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
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
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
                className="mb-2 text-[11px] font-semibold leading-relaxed"
                style={{ color: "var(--color-atrisk)" }}
              >
                開了票不等於錢出去了。填上票期，現金流才會把這筆算在正確的那一週。
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="支票到期日" required>
                  <input
                    type="date"
                    value={checkDue}
                    onChange={(e) => setCheckDue(e.target.value)}
                    className={inputClass}
                  />
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
        <p className="text-[11px] text-ink-3">支票沒填票期也能存，但現金流會用開票日估算。</p>
      )}
    </Modal>
  );
}
