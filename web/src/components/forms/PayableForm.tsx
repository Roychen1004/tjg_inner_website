/**
 * 登錄計價（建立應付款項）
 *
 * 表單只問三件事：**多少、哪天送單、怎麼付。**
 * 稅額、保留款、付款日全部由系統算——那三個是每次都會忘、
 * 忘了就每筆差 5–10% 的東西。
 *
 * 算出來的結果**當場顯示**，不是存檔後才看得到。
 * 使用者要能在按下儲存之前就看出「這筆實際會匯 95 萬不是 100 萬」。
 */
import { useMemo, useState } from "react";

import { ApiError } from "@/api/client";
import { useOptions, useSavePayable } from "@/api/hooks";
import { useVendors } from "@/api/hooks/useVendors";
import type { Payable, Subcontract } from "@/api/types";
import { Button, Field, FormErrors, Modal, Money, inputClass } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";

const TAX_RATE = 0.05;

export default function PayableForm({
  project,
  subcontract,
  payable,
  onClose,
}: {
  project?: number;
  /** 有合約時：專案、廠商、類別、付款條件、保留款比例全部跟著合約走 */
  subcontract?: Subcontract | null;
  payable?: Payable | null;
  onClose: () => void;
}) {
  const { data: options } = useOptions();
  const { data: vendors } = useVendors();
  const save = useSavePayable();
  const toast = useToast();
  const [error, setError] = useState<ApiError | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    vendor: String(payable?.vendor ?? ""),
    category: payable?.category ?? subcontract?.category ?? "material",
    title: payable?.title ?? "",
    amount: payable?.amount ?? "",
    tax_amount: payable?.tax_amount ?? "",
    retention_amount: payable?.retention_amount ?? "",
    billing_date: payable?.billing_date ?? today,
    due_date: payable?.due_date ?? "",
    payment_method: payable?.payment_method ?? "transfer",
    check_due_date: payable?.check_due_date ?? "",
    check_no: payable?.check_no ?? "",
    invoice_no: payable?.invoice_no ?? "",
    note: payable?.note ?? "",
  });

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  // 系統會怎麼算——在按下儲存之前就讓人看到
  const preview = useMemo(() => {
    const amount = Number(form.amount) || 0;
    const tax = form.tax_amount === "" ? Math.round(amount * TAX_RATE) : Number(form.tax_amount);
    const retentionPct = Number(subcontract?.retention_pct ?? 0);
    const retention =
      form.retention_amount === ""
        ? Math.round((amount * retentionPct) / 100)
        : Number(form.retention_amount);
    return { amount, tax, retention, payable: amount + tax - retention };
  }, [form.amount, form.tax_amount, form.retention_amount, subcontract]);

  function submit() {
    setError(null);
    save.mutate(
      {
        id: payable?.id,
        subcontract: subcontract?.id ?? payable?.subcontract ?? null,
        project: subcontract?.project ?? project,
        vendor: subcontract?.vendor ?? (form.vendor ? Number(form.vendor) : undefined),
        category: form.category,
        title: form.title,
        amount: form.amount,
        // 空字串代表「沒填，讓系統算」；填了 0 代表「真的是 0」。
        // 兩者不能都送成 0，否則免稅項目會被硬加 5%
        tax_amount: form.tax_amount === "" ? null : form.tax_amount,
        retention_amount: form.retention_amount === "" ? undefined : form.retention_amount,
        billing_date: form.billing_date || null,
        due_date: form.due_date || null,
        payment_method: form.payment_method,
        check_due_date: form.check_due_date || null,
        check_no: form.check_no,
        invoice_no: form.invoice_no,
        note: form.note,
      },
      {
        onSuccess: (result) => {
          toast.success(
            `已登錄「${result.title}」`,
            [
              `實付 ${Number(result.payable_amount).toLocaleString("zh-TW")} 元`,
              result.due_date ? `預計 ${result.due_date} 付款` : "付款日未定",
            ],
          );
          onClose();
        },
        onError: (e) => {
          if (e instanceof ApiError) setError(e);
          else toast.error("儲存失敗");
        },
      },
    );
  }

  const HANDLED = [
    "vendor", "title", "amount", "retention_amount", "check_due_date", "category", "project",
  ];
  const isCheck = form.payment_method === "check";

  return (
    <Modal
      open
      onClose={onClose}
      title={payable ? "編輯應付款項" : "登錄計價"}
      footer={
        <>
          <Button className="flex-1" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            loading={save.isPending}
            disabled={!form.title || !form.amount || (!subcontract && !form.vendor)}
            onClick={submit}
          >
            儲存
          </Button>
        </>
      }
    >
      <FormErrors error={error} handled={HANDLED} />

      {subcontract ? (
        <p className="mb-3 rounded-lg bg-page px-3 py-2 text-[11px] leading-relaxed text-ink-2">
          屬於合約 <strong>{subcontract.code} {subcontract.title}</strong>（{subcontract.vendor_name}）。
          專案、廠商、付款條件
          {Number(subcontract.retention_pct) > 0 && `與保留款 ${subcontract.retention_pct}%`}
          都跟著這張合約走。
        </p>
      ) : (
        <>
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
          <Field label="類別" required error={error?.fieldError("category")}>
            <select value={form.category} onChange={set("category")} className={inputClass}>
              {(options?.subcontract_category ?? []).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}

      <Field label="項目" required error={error?.fieldError("title")} hint="如「第三期計價」「2月份鋼材」">
        <input value={form.title} onChange={set("title")} className={inputClass} />
      </Field>

      <Field label="未稅金額" required error={error?.fieldError("amount")}>
        <input
          type="number"
          inputMode="numeric"
          value={form.amount}
          onChange={set("amount")}
          className={inputClass}
        />
      </Field>

      {/* ★ 算給人看。存檔後才發現少扣保留款，就要走退狀態、填原因那一整套 */}
      {preview.amount > 0 && (
        <dl className="mb-3 space-y-1 rounded-lg bg-page px-3 py-2 text-[11px]">
          <Line label="未稅" value={preview.amount} />
          <Line label={`稅額（${form.tax_amount === "" ? "自動 5%" : "自填"}）`} value={preview.tax} />
          {preview.retention > 0 && <Line label="扣保留款" value={-preview.retention} />}
          <div className="flex justify-between border-t border-line pt-1 font-bold text-ink">
            <dt>實際會匯出去</dt>
            <dd>
              <Money value={preview.payable} /> 元
            </dd>
          </div>
        </dl>
      )}

      <details className="mb-3">
        <summary className="cursor-pointer text-xs font-semibold text-ink-2">
          稅額與保留款要自己填？
        </summary>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <Field label="稅額" hint="留空＝自動 5%。免稅請填 0">
            <input
              type="number"
              inputMode="numeric"
              value={form.tax_amount}
              onChange={set("tax_amount")}
              placeholder="自動"
              className={inputClass}
            />
          </Field>
          <Field label="保留款" error={error?.fieldError("retention_amount")} hint="留空＝依合約比例">
            <input
              type="number"
              inputMode="numeric"
              value={form.retention_amount}
              onChange={set("retention_amount")}
              placeholder="自動"
              className={inputClass}
            />
          </Field>
        </div>
      </details>

      <div className="grid grid-cols-2 gap-3">
        <Field label="計價日" hint="包商送單日。付款日由此起算">
          <input
            type="date"
            value={form.billing_date}
            onChange={set("billing_date")}
            className={inputClass}
          />
        </Field>
        <Field label="預計付款日" hint="留空＝依合約帳期自動算">
          <input type="date" value={form.due_date} onChange={set("due_date")} className={inputClass} />
        </Field>
      </div>

      <Field label="付款方式">
        <select value={form.payment_method} onChange={set("payment_method")} className={inputClass}>
          {(options?.payment_method ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>

      {/* 支票是現金流最容易算錯的地方，所以只有選了支票才問，而且講清楚為什麼要問 */}
      {isCheck && (
        <div className="mb-3 rounded-lg px-3 py-2.5" style={{ background: "var(--color-atrisk-bg)" }}>
          <p className="mb-2 text-[11px] font-semibold leading-relaxed" style={{ color: "var(--color-atrisk)" }}>
            開票日不等於兌現日。沒填票期的話，現金流會把這筆錢算成提早兩三個月流出。
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="支票到期日" error={error?.fieldError("check_due_date")}>
              <input
                type="date"
                value={form.check_due_date}
                onChange={set("check_due_date")}
                className={inputClass}
              />
            </Field>
            <Field label="票號">
              <input value={form.check_no} onChange={set("check_no")} className={inputClass} />
            </Field>
          </div>
        </div>
      )}

      <Field label="發票號碼">
        <input value={form.invoice_no} onChange={set("invoice_no")} className={inputClass} />
      </Field>
      <Field label="備註">
        <textarea value={form.note} onChange={set("note")} rows={2} className={inputClass} />
      </Field>
    </Modal>
  );
}

function Line({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between text-ink-2">
      <dt>{label}</dt>
      <dd>
        <Money value={value} /> 元
      </dd>
    </div>
  );
}
