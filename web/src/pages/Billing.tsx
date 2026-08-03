/**
 * 請款收款
 *
 * 回答的問題：**錢收得回來嗎**。
 *
 * 兩層結構對應真實世界：
 *   里程碑 = 合約上寫的那一條
 *   請款事件 = 實際能開發票的那一筆
 *
 * 為什麼要分兩層：合約寫「每批到貨按噸數比例請款」時，
 * 一條里程碑會生出 N 筆請款事件。硬塞在一層裡，狀態機會打結。
 */
import { AlertTriangle, Lock, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { ApiError, api } from "@/api/client";
import { useBillingSummary, useClaims, useMilestones, useOptions, useTransitionClaim } from "@/api/hooks";
import { useCurrentUser } from "@/api/hooks/useAuth";
import type { Claim, Milestone } from "@/api/types";
import { BillingHelpButton } from "@/components/billing/BillingExplainer";
import SetupCheck from "@/components/billing/SetupCheck";
import MilestoneForm from "@/components/forms/MilestoneForm";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  FormErrors,
  inputClass,
  KpiCard,
  Modal,
  Money,
  ProgressBar,
  Select,
  Spinner,
} from "@/components/ui";
import { useStickyParams } from "@/lib/stickyParams";
import { useToast } from "@/components/ui/Toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";

const BILLING_KEYS = ["project", "tab"];

export default function Billing() {
  const { data: options } = useOptions();
  const { data: user } = useCurrentUser();
  // 專案與分頁放在網址上，「該做的」那些連結才能把人帶到正確的位置；
  // 同時記住上次的選擇，從導航列點進來時還原
  const [searchParams, setSearchParams] = useStickyParams("billing.filters", BILLING_KEYS);
  const project = searchParams.get("project") ?? "";
  const tab = (searchParams.get("tab") as "claims" | "milestones") ?? "claims";

  const setParam = (name: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(name, value);
    else next.delete(name);
    setSearchParams(next, { replace: true });
  };
  const setProject = (v: string) => setParam("project", v);
  const setTab = (v: string) => setParam("tab", v);

  const { data: summary } = useBillingSummary();
  const claims = useClaims({ project: project || undefined, page_size: 50 });
  const milestones = useMilestones({ project: project || undefined, page_size: 50 });
  const [transitioning, setTransitioning] = useState<Claim | null>(null);
  const [editingMilestone, setEditingMilestone] = useState<Milestone | null>(null);
  const [creatingMilestone, setCreatingMilestone] = useState(false);
  const [manualClaiming, setManualClaiming] = useState<Milestone | null>(null);

  const active = tab === "claims" ? claims : milestones;
  const canEdit = Boolean(user?.permissions.edit_milestone);

  return (
    <div>
      {summary && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <KpiCard label="未到期" value={fmtWan(summary.pending)} unit="萬" />
          <KpiCard
            label="可請款"
            value={fmtWan(summary.claimable)}
            unit="萬"
            status={summary.claimable_count ? "warn" : "neutral"}
            detail={`${summary.claimable_count} 筆待開單`}
          />
          <KpiCard label="已請款" value={fmtWan(summary.invoiced)} unit="萬" />
          <KpiCard
            label="已收款"
            value={fmtWan(summary.received)}
            unit="萬"
            status="good"
          />
        </div>
      )}

      {summary && summary.overdue_claimable.count > 0 && (
        <div
          className="mb-4 flex items-start gap-2 rounded-xl px-3 py-2.5"
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

      {/* 選了專案才檢查得起來——沒選專案時檢查什麼都不知道 */}
      {project && <SetupCheck projectId={Number(project)} />}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg bg-page p-0.5">
          {(["claims", "milestones"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={[
                "rounded-md px-3 py-1.5 text-xs font-semibold transition-base",
                tab === key ? "bg-card text-ink shadow-sm" : "text-ink-2",
              ].join(" ")}
            >
              {key === "claims" ? "請款事件" : "合約里程碑"}
            </button>
          ))}
        </div>
        <Select
          value={project}
          onChange={setProject}
          options={(options?.projects ?? []).map((p) => ({ value: p.id, label: p.name }))}
          placeholder="全部專案"
        />
        {canEdit && (
          <Button variant="primary" onClick={() => setCreatingMilestone(true)}>
            <Plus size={15} />
            新增里程碑
          </Button>
        )}
        <BillingHelpButton />
      </div>

      {/* 兩個分頁的名字看起來很像，但一個是「計畫」一個是「事實」。
          在使用者困惑的當下講，比寫在文件裡等人去讀有效 */}
      <p className="mb-3 rounded-lg bg-card px-3 py-2 text-[11px] leading-relaxed text-ink-2 ring-1 ring-line">
        {tab === "claims" ? (
          <>
            <strong className="text-ink">請款事件＝實際可以開發票的那一筆錢。</strong>{" "}
            由現場登錄簽收時<strong>系統自動產生</strong>；手動型的里程碑則由會計自己按。
            在這裡把狀態從「可請款」推到「已請款」→「已收款」。
          </>
        ) : (
          <>
            <strong className="text-ink">合約里程碑＝合約上寫的請款條件。</strong>{" "}
            簽完約<strong>由你自己建</strong>——把合約每一條抄進來，
            系統才知道什麼時候該提醒你請款。建好之後就不用管了。
          </>
        )}
      </p>

      {active.isLoading ? (
        <Spinner />
      ) : active.error ? (
        <ErrorState error={active.error} onRetry={active.refetch} />
      ) : tab === "claims" ? (
        !claims.data?.results.length ? (
          <EmptyState
            title="目前沒有請款事件"
            hint={
              milestones.data?.results.length
                ? "請款事件由「簽收」產生。到追蹤看板把批次推到「進場簽收」並登錄簽收後，" +
                  "系統會依里程碑設定的觸發方式判斷要不要轉為可請款"
                : "這個範圍還沒有設定請款里程碑。里程碑是合約上寫的請款條件——" +
                  "沒有它，簽收再多批也不會有錢跑出來，因為系統不知道什麼情況算可以請款"
            }
            action={
              canEdit && !milestones.data?.results.length ? (
                <Button variant="primary" onClick={() => setCreatingMilestone(true)}>
                  <Plus size={14} />
                  建立第一筆里程碑
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="space-y-2">
            {claims.data.results.map((claim) => (
              <ClaimRow key={claim.id} claim={claim} onTransition={setTransitioning} />
            ))}
          </ul>
        )
      ) : !milestones.data?.results.length ? (
        <EmptyState
          title="這個範圍內沒有請款里程碑"
          hint="把合約上的每一條請款條件建成一筆里程碑，系統才知道什麼時候該提醒你請款"
          action={
            canEdit ? (
              <Button variant="primary" onClick={() => setCreatingMilestone(true)}>
                <Plus size={14} />
                新增里程碑
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="space-y-2">
          {milestones.data.results.map((m) => (
            <MilestoneRow
              key={m.id}
              milestone={m}
              onEdit={canEdit ? setEditingMilestone : undefined}
              onManualClaim={canEdit ? setManualClaiming : undefined}
            />
          ))}
        </ul>
      )}

      <TransitionDialog claim={transitioning} onClose={() => setTransitioning(null)} />
      <MilestoneForm
        open={creatingMilestone}
        onClose={() => setCreatingMilestone(false)}
        defaultProject={project ? Number(project) : undefined}
      />
      <MilestoneForm
        open={editingMilestone !== null}
        onClose={() => setEditingMilestone(null)}
        milestone={editingMilestone}
      />
      <ManualClaimDialog
        milestone={manualClaiming}
        onClose={() => setManualClaiming(null)}
      />
    </div>
  );
}

function ClaimRow({
  claim,
  onTransition,
}: {
  claim: Claim;
  onTransition: (claim: Claim) => void;
}) {
  const overdue = claim.state === "claimable" && (claim.days_since_claimable ?? 0) > 7;
  return (
    <Card className="p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-ink">
            {claim.project_name} · {claim.milestone_label}
          </p>
          <p className="mt-0.5 text-[11px] text-ink-3">
            {claim.source_label}
            {claim.triggered_by_name && ` · 由「${claim.triggered_by_name}」簽收觸發`}
            {claim.weight_kg_snapshot &&
              ` · ${(Number(claim.weight_kg_snapshot) / 1000).toFixed(1)} 噸`}
            {claim.invoice_no && ` · 單號 ${claim.invoice_no}`}
          </p>
        </div>
        <div className="text-right">
          <p className="text-base font-bold tabular-nums text-ink">
            <Money value={claim.amount} />
          </p>
          <span className="text-[11px] font-semibold text-ink-2">{claim.state_label}</span>
        </div>
      </div>

      {overdue && (
        <p className="mt-1.5 text-[11px]" style={{ color: "var(--color-delayed)" }}>
          可請款已 {claim.days_since_claimable} 天未開單
        </p>
      )}

      {claim.next_states.length > 0 && (
        <div className="mt-2.5">
          <Button variant="primary" onClick={() => onTransition(claim)}>
            變更狀態
          </Button>
        </div>
      )}
    </Card>
  );
}

function MilestoneRow({
  milestone: m,
  onEdit,
  onManualClaim,
}: {
  milestone: Milestone;
  onEdit?: (m: Milestone) => void;
  onManualClaim?: (m: Milestone) => void;
}) {
  return (
    <Card className="p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-ink">
            {m.project_name} · {m.seq}. {m.label}
          </p>
          <p className="mt-0.5 text-xs text-ink-2">{m.trigger_desc}</p>
        </div>
        <div className="flex items-start gap-2">
          <div className="text-right">
            <p className="text-base font-bold tabular-nums text-ink">
              <Money value={m.amount} />
            </p>
            <span className="text-[11px] text-ink-3">{m.percentage}%</span>
          </div>
          {onEdit && (
            <button
              type="button"
              onClick={() => onEdit(m)}
              aria-label="修改里程碑"
              className="h-7 min-h-0 rounded-lg p-1.5 text-ink-3 hover:bg-page"
            >
              <Pencil size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="rounded bg-page px-1.5 py-0.5 font-semibold text-ink-2">
          {m.trigger_label}
        </span>
        <span className="rounded bg-page px-1.5 py-0.5 font-semibold text-ink-2">
          {m.state_label}
        </span>
        {/* 綁了期別就只看該期的批次；沒綁就是全案 */}
        <span
          className="rounded px-1.5 py-0.5 font-semibold"
          style={
            m.phase_name
              ? { background: "var(--color-stage-1)", color: "#fff" }
              : { background: "var(--color-page)", color: "var(--color-ink-3)" }
          }
        >
          {m.phase_name ? `只看 ${m.phase_name}` : "全案範圍"}
        </span>
        {m.target_location_name && (
          <span className="text-ink-3">交貨地點：{m.target_location_name}</span>
        )}
        {m.is_weight_basis_locked && (
          <span className="inline-flex items-center gap-0.5 text-ink-3" title="首次觸發時已固化分母，要改必須綁已核准的變更追加單">
            <Lock size={10} />
            分母已鎖定 {(Number(m.weight_basis_kg) / 1000).toFixed(1)} 噸
          </span>
        )}
      </div>

      {/* 「還不能請」不夠——要說出還差多遠 */}
      <div className="mt-2.5">
        {m.progress.pct !== null ? (
          <ProgressBar
            value={m.progress.pct}
            label={m.progress.text}
            color={
              m.progress.threshold_pct && m.progress.pct >= m.progress.threshold_pct
                ? "var(--color-ontrack)"
                : undefined
            }
          />
        ) : (
          <p className="text-xs text-ink-3">{m.progress.text}</p>
        )}
        {m.progress.threshold_pct != null && (
          <p className="mt-1 text-[11px] text-ink-3">觸發門檻 {m.progress.threshold_pct}%</p>
        )}
      </div>

      {/* 「還差 3 批」要說得出是哪 3 批、現在在哪、下一步做什麼——
          否則使用者看完還是不知道要做什麼 */}
      {m.progress.pending && m.progress.pending.length > 0 && (
        <div className="mt-2.5 rounded-lg bg-page p-2.5">
          <p className="mb-1.5 text-[11px] font-semibold text-ink">
            還差這 {m.progress.pending.length} 批簽收才會觸發
          </p>
          <ul className="space-y-1">
            {m.progress.pending.map((u) => (
              <li key={u.id} className="flex flex-wrap items-baseline gap-x-1.5 text-[11px]">
                <Link
                  to={`/tracking?project=${m.project}&unit=${u.id}`}
                  className="font-semibold text-stage-2 hover:underline"
                >
                  {u.name}
                </Link>
                <span className="text-ink-3">{u.stage_name}</span>
                <span
                  style={{
                    color: u.ready_to_sign ? "var(--color-atrisk)" : "var(--color-ink-3)",
                  }}
                >
                  {u.ready_to_sign ? "← 可以登錄簽收了" : u.hint}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {onManualClaim && m.trigger_type === "manual" && Number(m.remaining_claimable) > 0 && (
        <div className="mt-2.5">
          <Button variant="primary" onClick={() => onManualClaim(m)}>
            <Plus size={13} />
            建立請款
          </Button>
          <p className="mt-1 text-[11px] text-ink-3">
            手動型不會自動觸發——合約條件（如「簽約後七日內」）系統判不出來，由你自己按
          </p>
        </div>
      )}

      {m.claims.length > 0 && (
        <div className="mt-2.5">
          <p className="mb-1 text-[11px] font-semibold text-ink-2">
            已產生 {m.claims.length} 筆請款事件
          </p>
          <ul className="space-y-1">
            {m.claims.map((c) => (
              <li key={c.id} className="flex justify-between rounded bg-page px-2 py-1 text-[11px]">
                <span className="truncate text-ink-2">
                  {c.triggered_by_name || c.source_label}
                </span>
                <span className="shrink-0 font-semibold text-ink">
                  <Money value={c.amount} /> · {c.state_label}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function TransitionDialog({ claim, onClose }: { claim: Claim | null; onClose: () => void }) {
  const [toState, setToState] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [invoiceNo, setInvoiceNo] = useState("");
  const [reason, setReason] = useState("");
  const transition = useTransitionClaim();
  const toast = useToast();

  const error = transition.error instanceof ApiError ? transition.error : null;
  const ORDER: Record<string, number> = { claimable: 0, invoiced: 1, received: 2 };
  const isBackward = claim ? ORDER[toState] < ORDER[claim.state] : false;

  function submit() {
    if (!claim) return;
    transition.mutate(
      { id: claim.id, to_state: toState, date, invoice_no: invoiceNo, reason },
      {
        onSuccess: (updated) => {
          toast.success(`${claim.milestone_label} → ${updated.state_label}`);
          close();
        },
      },
    );
  }

  function close() {
    setToState("");
    setInvoiceNo("");
    setReason("");
    transition.reset();
    onClose();
  }

  return (
    <Modal open={claim !== null} onClose={close} title="變更請款狀態">
      {claim && (
        <div>
          <p className="mb-4 text-sm text-ink-2">
            {claim.project_name} · {claim.milestone_label}
            <span className="ml-2 font-bold text-ink">
              <Money value={claim.amount} /> 元
            </span>
          </p>

          <Field label="轉為" required>
            <Select
              value={toState}
              onChange={setToState}
              options={claim.next_states}
              placeholder="請選擇"
              className="w-full"
            />
          </Field>

          {toState && !isBackward && (
            <Field label={toState === "invoiced" ? "請款日" : "收款日"} required>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={inputClass}
              />
            </Field>
          )}

          {toState === "invoiced" && (
            <Field label="請款單號" hint="選填，之後對帳用">
              <input
                value={invoiceNo}
                onChange={(e) => setInvoiceNo(e.target.value)}
                className={inputClass}
              />
            </Field>
          )}

          {isBackward && (
            <Field label="往回轉的原因" required hint="會留在不可竄改的異動歷程裡">
              <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} />
            </Field>
          )}

          <FormErrors error={error} />

          <div className="flex gap-2">
            <Button onClick={close} className="flex-1">
              取消
            </Button>
            <Button
              variant="primary"
              onClick={submit}
              loading={transition.isPending}
              disabled={!toState || (isBackward && !reason.trim())}
              className="flex-1"
            >
              確定
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/**
 * 手動建立請款事件
 *
 * 給 trigger_type = manual 的里程碑用。有些合約條件系統判不出來
 * （「簽約後七日內」系統看不到合約簽了沒、「驗收合格」不知道業主驗了沒），
 * 就讓會計自己按。
 */
function ManualClaimDialog({
  milestone,
  onClose,
}: {
  milestone: Milestone | null;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [loadedId, setLoadedId] = useState<number | null>(null);
  const toast = useToast();
  const qc = useQueryClient();

  // 開啟時預設帶「剩餘可請金額」——多數情況就是全額請完
  if (milestone && loadedId !== milestone.id) {
    setLoadedId(milestone.id);
    setAmount(milestone.remaining_claimable);
    setNote("");
  }
  if (!milestone && loadedId !== null) setLoadedId(null);

  const create = useMutation({
    mutationFn: () =>
      api.post<Claim>(`/billing-milestones/${milestone!.id}/manual-claim`, {
        amount,
        note,
      }),
    onSuccess: (claim) => {
      qc.invalidateQueries({ queryKey: ["billing"] });
      toast.success(`已建立請款 ${Number(claim.amount).toLocaleString("zh-TW")} 元`, [
        "已通知會計與經營者。到「請款事件」分頁把狀態推到已請款",
      ]);
      onClose();
    },
  });
  const error = create.error instanceof ApiError ? create.error : null;

  const remaining = Number(milestone?.remaining_claimable ?? 0);
  const over = Number(amount || 0) > remaining;

  return (
    <Modal open={milestone !== null} onClose={onClose} title="建立請款">
      {milestone && (
        <div>
          <p className="mb-1 text-sm text-ink-2">
            {milestone.project_name} · {milestone.label}
          </p>
          <p className="mb-4 text-[11px] leading-relaxed text-ink-3">
            {milestone.trigger_desc || "手動觸發，由你決定何時請款"}
          </p>

          <Field
            label="金額"
            required
            hint={`此里程碑還能請 ${remaining.toLocaleString("zh-TW")} 元（總額 ${Number(milestone.amount).toLocaleString("zh-TW")}）`}
            error={over ? "超過剩餘可請金額" : error?.fieldError("amount")}
          >
            <input
              type="number"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label="備註" hint="如「依合約第三條，簽約後七日內」">
            <input value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} />
          </Field>

          <FormErrors error={error} handled={["amount"]} />

          <div className="flex gap-2">
            <Button onClick={onClose} className="flex-1">
              取消
            </Button>
            <Button
              variant="primary"
              onClick={() => create.mutate()}
              loading={create.isPending}
              disabled={!amount || Number(amount) <= 0 || over}
              className="flex-1"
            >
              建立
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function fmtWan(value: string) {
  return Math.round(Number(value) / 10000).toLocaleString("zh-TW");
}
