/**
 * 應收款狀態轉換視窗
 *
 * 金流→應收 與 專案明細 共用同一個——狀態機只有一份。
 */
import { useState } from "react";

import { ApiError } from "@/api/client";
import { useTransitionMilestone } from "@/api/hooks";
import type { Milestone } from "@/api/types";
import { Button, Field, FormErrors, Modal, Money, inputClass } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";

export default function MilestoneTransitionModal({ milestone, onClose }: { milestone: Milestone; onClose: () => void }) {
  const transition = useTransitionMilestone();
  const toast = useToast();
  const [error, setError] = useState<ApiError | null>(null);

  const [target, setTarget] = useState(milestone.next_states[0]?.value ?? "");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [invoiceNo, setInvoiceNo] = useState(milestone.invoice_no);
  const [reason, setReason] = useState("");

  const ORDER: Record<string, number> = { pending: 0, claimable: 1, invoiced: 2, received: 3 };
  const isBackward = ORDER[target] < ORDER[milestone.state];
  const isInvoicing = target === "invoiced" && !isBackward;
  const isReceiving = target === "received";

  function submit() {
    setError(null);
    transition.mutate(
      {
        id: milestone.id,
        to_state: target,
        date: isInvoicing || isReceiving ? date : undefined,
        invoice_no: isInvoicing ? invoiceNo : undefined,
        reason: isBackward ? reason : undefined,
      },
      {
        onSuccess: (result) => {
          toast.success(
            `已轉為「${result.state_label}」`,
            result.state === "invoiced" && result.due_date
              ? [`預計收款日 ${result.due_date}（依客戶帳期自動帶入）`]
              : undefined,
          );
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
      title={`${milestone.project_name}·${milestone.label}`}
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
      <FormErrors error={error} handled={["reason", "date", "invoice_no"]} />

      <p className="mb-3 text-sm text-ink-2">
        金額 <Money value={milestone.amount} className="font-bold text-ink" /> 元
      </p>

      <Field label="轉為" required>
        <select value={target} onChange={(e) => setTarget(e.target.value)} className={inputClass}>
          {milestone.next_states.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>

      {isInvoicing && (
        <>
          <Field label="請款日" required hint="預計收款日＝請款日＋客戶帳期，會自動帶入">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
          </Field>
          <Field label="請款單號">
            <input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} className={inputClass} />
          </Field>
        </>
      )}

      {isReceiving && (
        <Field label="收款日" required>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
        </Field>
      )}

      {isBackward && (
        <Field label="退回原因" required hint="錢的狀態被改過而沒人知道，是查帳時最麻煩的事">
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className={inputClass} />
        </Field>
      )}
    </Modal>
  );
}
