/**
 * 分包合約
 *
 * 掛在專案頁底下，跟變更追加單同一區——因為它就是專案的另一半：
 *
 *     專案      ＝ 業主付我們多少
 *     分包合約  ＝ 我們付別人多少
 *
 * 兩邊都有了，才算得出這個案子賺不賺。
 */
import { AlertTriangle, Pencil, Plus, Receipt, Trash2 } from "lucide-react";
import { useState } from "react";

import { ApiError } from "@/api/client";
import {
  useDeleteSubcontract,
  useOptions,
  useSaveSubcontract,
  useSubcontracts,
} from "@/api/hooks";
import { useCurrentUser } from "@/api/hooks/useAuth";
import type { ProjectDetail, Subcontract } from "@/api/types";
import { Button, Card, DateInput, Field, FormErrors, inputClass, Modal, Money, ProgressBar, SectionTitle } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import PayableForm from "@/components/forms/PayableForm";
import { useVendors } from "@/api/hooks/useVendors";

export default function SubcontractSection({ project }: { project: ProjectDetail }) {
  const { data: user } = useCurrentUser();
  const { data } = useSubcontracts({ project: project.id }, Boolean(user?.permissions.view_payables));
  const [editing, setEditing] = useState<Subcontract | null>(null);
  const [creating, setCreating] = useState(false);
  const [billing, setBilling] = useState<Subcontract | null>(null);

  const rows = data?.results ?? [];
  const canEdit = Boolean(user?.permissions.edit_subcontract);
  const canBill = Boolean(user?.permissions.edit_payable);

  if (!user?.permissions.view_payables) return null;
  if (!rows.length && !canEdit) return null;

  return (
    <div className="mt-4">
      <SectionTitle
        action={
          canEdit ? (
            <Button variant="ghost" onClick={() => setCreating(true)}>
              <Plus size={13} />
              新增分包合約
            </Button>
          ) : undefined
        }
      >
        分包合約（我們要付的）
      </SectionTitle>

      {rows.length === 0 ? (
        <p className="rounded-lg bg-page px-3 py-2 text-[11px] leading-relaxed text-ink-2">
          跟包商、材料商、外包廠簽的合約放這裡。
          <strong>有了它，這個案子的成本與現金流才算得出來</strong>——
          否則系統只知道錢什麼時候進來，不知道什麼時候出去。
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <Row
              key={row.id}
              row={row}
              canEdit={canEdit}
              canBill={canBill}
              onEdit={() => setEditing(row)}
              onBill={() => setBilling(row)}
            />
          ))}
        </ul>
      )}

      {(creating || editing) && (
        <FormModal
          project={project}
          subcontract={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
      {billing && (
        <PayableForm
          project={project.id}
          subcontract={billing}
          onClose={() => setBilling(null)}
        />
      )}
    </div>
  );
}

function Row({
  row,
  canEdit,
  canBill,
  onEdit,
  onBill,
}: {
  row: Subcontract;
  canEdit: boolean;
  canBill: boolean;
  onEdit: () => void;
  onBill: () => void;
}) {
  const remove = useDeleteSubcontract();
  const toast = useToast();
  const billedPct = row.billed_pct ?? 0;

  return (
    <Card as="li" className="p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{row.title}</p>
          <p className="mt-0.5 text-[11px] text-ink-3">
            {row.code} · {row.vendor_name} · {row.category_label}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canBill && (
            <Button variant="ghost" onClick={onBill} title="登錄這張合約的計價">
              <Receipt size={13} />
              計價
            </Button>
          )}
          {canEdit && (
            <>
              <Button variant="ghost" onClick={onEdit} aria-label="編輯">
                <Pencil size={13} />
              </Button>
              <Button
                variant="ghost"
                aria-label="刪除"
                onClick={() => {
                  if (!confirm(`確定刪除「${row.title}」？`)) return;
                  remove.mutate(row.id, {
                    onSuccess: () => toast.success("已刪除"),
                    onError: (e) =>
                      toast.error(e instanceof ApiError ? e.message : "刪除失敗"),
                  });
                }}
              >
                <Trash2 size={13} />
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="mt-2">
        <ProgressBar
          value={billedPct}
          label={`已計價 ${billedPct.toFixed(0)}%`}
          compact
        />
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
        <Stat label="合約額" value={row.contract_amount} />
        <Stat label="已計價" value={row.billed_amount} />
        <Stat label="已付款" value={row.paid_amount} />
      </dl>
      <p className="mt-2 text-[11px] text-ink-3">
        {row.payment_terms_display}
        {Number(row.retention_pct) > 0 && ` · 保留款 ${row.retention_pct}%`}
      </p>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-ink-3">{label}</dt>
      <dd className="font-semibold text-ink">
        <Money value={value} compact />
      </dd>
    </div>
  );
}

function FormModal({
  project,
  subcontract,
  onClose,
}: {
  project: ProjectDetail;
  subcontract: Subcontract | null;
  onClose: () => void;
}) {
  const { data: options } = useOptions();
  const { data: vendors } = useVendors();
  const save = useSaveSubcontract();
  const toast = useToast();
  const [error, setError] = useState<ApiError | null>(null);

  const [form, setForm] = useState({
    vendor: subcontract?.vendor ? String(subcontract.vendor) : "",
    title: subcontract?.title ?? "",
    category: subcontract?.category ?? "subcontract",
    contract_amount: subcontract?.contract_amount ?? "",
    payment_term_type: subcontract?.payment_term_type ?? "month_end",
    payment_term_days: String(subcontract?.payment_term_days ?? 30),
    retention_pct: subcontract?.retention_pct ?? "0",
    start_date: subcontract?.start_date ?? "",
    end_date: subcontract?.end_date ?? "",
    status: subcontract?.status ?? "active",
    note: subcontract?.note ?? "",
  });

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  function submit() {
    setError(null);
    save.mutate(
      {
        id: subcontract?.id,
        project: project.id,
        vendor: Number(form.vendor),
        title: form.title,
        category: form.category,
        contract_amount: form.contract_amount,
        payment_term_type: form.payment_term_type,
        payment_term_days: Number(form.payment_term_days),
        retention_pct: form.retention_pct || "0",
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        status: form.status,
        note: form.note,
      },
      {
        onSuccess: () => {
          toast.success(subcontract ? "已更新分包合約" : "已建立分包合約");
          onClose();
        },
        onError: (e) => {
          if (e instanceof ApiError) setError(e);
          else toast.error("儲存失敗");
        },
      },
    );
  }

  const HANDLED = ["vendor", "title", "contract_amount", "end_date", "payment_term_days"];

  return (
    <Modal
      open
      onClose={onClose}
      title={subcontract ? `編輯 ${subcontract.code}` : "新增分包合約"}
      footer={
        <>
          <Button className="flex-1" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            loading={save.isPending}
            disabled={!form.vendor || !form.title || !form.contract_amount}
            onClick={submit}
          >
            儲存
          </Button>
        </>
      }
    >
      <FormErrors error={error} handled={HANDLED} />

      <Field label="廠商" required error={error?.fieldError("vendor")}>
        <select value={form.vendor} onChange={set("vendor")} className={inputClass}>
          <option value="">請選擇</option>
          {(vendors ?? []).map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="合約名稱" required error={error?.fieldError("title")} hint="如「B區土建工程」「第一期鋼材採購」">
        <input value={form.title} onChange={set("title")} className={inputClass} />
      </Field>

      <Field label="類別" required>
        <select value={form.category} onChange={set("category")} className={inputClass}>
          {(options?.subcontract_category ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="合約金額（未稅）"
        required
        error={error?.fieldError("contract_amount")}
        hint="填未稅。稅額在每次計價時自動加，現金流用含稅"
      >
        <input
          type="number"
          inputMode="numeric"
          value={form.contract_amount}
          onChange={set("contract_amount")}
          className={inputClass}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="付款條件" required>
          <select
            value={form.payment_term_type}
            onChange={set("payment_term_type")}
            className={inputClass}
          >
            {(options?.payment_term_type ?? []).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="帳期天數" required error={error?.fieldError("payment_term_days")}>
          <input
            type="number"
            inputMode="numeric"
            value={form.payment_term_days}
            onChange={set("payment_term_days")}
            className={inputClass}
          />
        </Field>
      </div>

      {/* 月結最容易算錯，所以直接在旁邊寫出來算法 */}
      {form.payment_term_type === "month_end" && (
        <p className="-mt-1 mb-3 flex gap-1.5 rounded-lg bg-page px-2.5 py-2 text-[11px] leading-relaxed text-ink-2">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>
            月結是從<strong>計價當月的月底</strong>開始算。
            例：1/15 計價、月結 {form.payment_term_days || 0} 天 → 1/31 結帳 →{" "}
            {monthEndExample(Number(form.payment_term_days) || 0)} 付款。
            <strong>不是從 1/15 開始算。</strong>
          </span>
        </p>
      )}

      <Field
        label="保留款（%）"
        hint="每期扣的百分比，驗收合格後退還。不填就是不扣——不算的話每期實付會高估"
      >
        <input
          type="number"
          inputMode="decimal"
          value={form.retention_pct}
          onChange={set("retention_pct")}
          className={inputClass}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="開始日">
          <DateInput value={form.start_date} onChange={(v) => set("start_date")({ target: { value: v } })} />
        </Field>
        <Field label="預計完成" error={error?.fieldError("end_date")} hint="未計價餘額會攤到這天之前">
          <DateInput value={form.end_date} onChange={(v) => set("end_date")({ target: { value: v } })} />
        </Field>
      </div>

      {subcontract && (
        <Field label="狀態">
          <select value={form.status} onChange={set("status")} className={inputClass}>
            {(options?.subcontract_status ?? []).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label="備註">
        <textarea value={form.note} onChange={set("note")} rows={2} className={inputClass} />
      </Field>
    </Modal>
  );
}

/** 1/15 計價、月結 N 天的付款日。純粹用來讓表單旁的說明是具體的 */
function monthEndExample(days: number) {
  const due = new Date(Date.UTC(2000, 0, 31));
  due.setUTCDate(due.getUTCDate() + days);
  return `${due.getUTCMonth() + 1}/${due.getUTCDate()}`;
}
