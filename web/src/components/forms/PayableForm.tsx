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
import {
  useFlowUnits,
  useMaterialItems,
  useOptions,
  useSaveMaterialItem,
  useSavePayable,
} from "@/api/hooks";
import { useVendors } from "@/api/hooks/useVendors";
import type { Payable, Subcontract } from "@/api/types";
import { Button, DateInput, Field, FormErrors, inputClass, Modal, Money } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";


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
    flow_unit: payable?.flow_unit ? String(payable.flow_unit) : "",
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

  // ── 明細（D52）：一張單拆多列品項×數量×單價，金額自動加總 ──
  const { data: items } = useMaterialItems();
  const saveItem = useSaveMaterialItem();
  const [lines, setLines] = useState<Array<{ item: string; qty: string; unit_price: string }>>(
    (payable?.lines ?? []).map((l) => ({
      item: String(l.item),
      qty: String(Number(l.qty)),
      unit_price: String(Number(l.unit_price)),
    })),
  );
  const validLines = lines.filter(
    (l) => l.item && Number(l.qty) > 0 && l.unit_price !== "" && Number(l.unit_price) >= 0,
  );
  const linesSum = validLines.reduce(
    (sum, l) => sum + Number(l.qty) * Number(l.unit_price), 0,
  );
  const useLines = lines.length > 0;

  const setLine = (i: number, k: "item" | "qty" | "unit_price") =>
    (e: { target: { value: string } }) =>
      setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: e.target.value } : l)));

  function addItemMaster(lineIndex: number) {
    const name = window.prompt("新增品項（如：鋼材、螺栓、混凝土）：")?.trim();
    if (!name) return;
    const uom = window.prompt("計量單位（如：噸、支、才）：")?.trim() ?? "";
    saveItem.mutate(
      { name, unit_of_measure: uom },
      {
        onSuccess: (createdItem) =>
          setLines((ls) =>
            ls.map((l, j) => (j === lineIndex ? { ...l, item: String(createdItem.id) } : l)),
          ),
        onError: (e) =>
          toast.error(e instanceof ApiError ? e.body.detail ?? "新增品項失敗" : "新增品項失敗"),
      },
    );
  }

  // 這筆錢屬於哪個案子——有合約跟合約走，否則用呼叫端給的專案
  const flowProject = subcontract?.project ?? payable?.project ?? project;
  const { data: flowUnits } = useFlowUnits(
    { project: flowProject, state: "todo,doing,done", page_size: 100 },
    Boolean(flowProject),
  );

  // 系統會怎麼算——在按下儲存之前就讓人看到
  const preview = useMemo(() => {
    // D52：有明細＝明細合計；否則看手填金額
    const amount = useLines ? linesSum : Number(form.amount) || 0;
    // D48：金額一律稅後，稅額固定 0（舊資料填過的由後端保留）
    const tax = 0;
    const retentionPct = Number(subcontract?.retention_pct ?? 0);
    const retention =
      form.retention_amount === ""
        ? Math.round((amount * retentionPct) / 100)
        : Number(form.retention_amount);
    return { amount, tax, retention, payable: amount + tax - retention };
  }, [form.amount, form.tax_amount, form.retention_amount, subcontract, useLines, linesSum]);

  function submit() {
    setError(null);
    save.mutate(
      {
        id: payable?.id,
        subcontract: subcontract?.id ?? payable?.subcontract ?? null,
        project: subcontract?.project ?? project,
        vendor: subcontract?.vendor ?? (form.vendor ? Number(form.vendor) : undefined),
        flow_unit: form.flow_unit ? Number(form.flow_unit) : null,
        category: form.category,
        title: form.title,
        // D52：有明細時金額由後端加總；清空明細（編輯時）送空陣列
        amount: useLines ? undefined : form.amount,
        lines: useLines
          ? validLines.map((l) => ({
              item: Number(l.item), qty: l.qty, unit_price: l.unit_price,
            }))
          : payable?.lines?.length
            ? []
            : undefined,
        // 空字串代表「沒填，讓系統算」；填了 0 代表「真的是 0」。
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
    "flow_unit", "lines",
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
            disabled={
              !form.title ||
              (useLines ? validLines.length === 0 : !form.amount) ||
              (!subcontract && !form.vendor)
            }
            onClick={submit}
          >
            儲存
          </Button>
        </>
      }
    >
      <FormErrors error={error} handled={HANDLED} />

      {subcontract ? (
        <p className="mb-3 rounded-lg bg-page px-3 py-2 text-xs leading-relaxed text-ink-2">
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

      {flowProject !== undefined && (flowUnits?.results.length ?? 0) > 0 && (
        <Field
          label="花在哪個流程（選填）"
          hint="掛上去之後，看流程單元就知道這一步花了多少錢"
          error={error?.fieldError("flow_unit")}
        >
          <select value={form.flow_unit} onChange={set("flow_unit")} className={inputClass}>
            <option value="">不掛流程</option>
            {(flowUnits?.results ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.flow_code} {u.flow_name}
              </option>
            ))}
          </select>
        </Field>
      )}

      {useLines ? (
        /* D52：明細列——品項×數量×單價，金額自動加總（單價統計靠這裡累積） */
        <Field label="明細（金額＝各列合計）" required error={error?.fieldError("lines")}>
          <div className="space-y-1.5">
            {lines.map((l, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <select
                  value={l.item}
                  onChange={setLine(i, "item")}
                  aria-label={`第 ${i + 1} 列品項`}
                  className={`${inputClass} min-w-0 flex-1`}
                >
                  <option value="">品項</option>
                  {(items ?? []).map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.name}{it.unit_of_measure && `（${it.unit_of_measure}）`}
                    </option>
                  ))}
                </select>
                {!l.item && (
                  <button
                    type="button"
                    onClick={() => addItemMaster(i)}
                    className="shrink-0 rounded-md px-1.5 py-1 text-xs font-semibold text-ink-2 ring-1 ring-line transition-base hover:bg-page"
                  >
                    ＋新品項
                  </button>
                )}
                <input
                  type="number"
                  inputMode="decimal"
                  value={l.qty}
                  onChange={setLine(i, "qty")}
                  placeholder="數量"
                  aria-label={`第 ${i + 1} 列數量`}
                  className={`${inputClass} w-20 shrink-0 text-right`}
                />
                <span className="shrink-0 text-xs text-ink-3">×</span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={l.unit_price}
                  onChange={setLine(i, "unit_price")}
                  placeholder="單價"
                  aria-label={`第 ${i + 1} 列單價`}
                  className={`${inputClass} w-24 shrink-0 text-right`}
                />
                <button
                  type="button"
                  onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                  aria-label={`刪除第 ${i + 1} 列`}
                  className="shrink-0 rounded p-1 text-ink-3 transition-base hover:text-[var(--color-delayed)]"
                >
                  ✕
                </button>
              </div>
            ))}
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setLines((ls) => [...ls, { item: "", qty: "", unit_price: "" }])}
                className="rounded-md px-1.5 py-1 text-xs font-semibold text-ink-2 ring-1 ring-line transition-base hover:bg-page"
              >
                ＋加一列
              </button>
              <span className="text-xs tabular-nums text-ink">
                合計 <Money value={linesSum} /> 元
              </span>
            </div>
          </div>
        </Field>
      ) : (
        <Field label="金額（稅後實際金額）" required error={error?.fieldError("amount")}>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              inputMode="numeric"
              value={form.amount}
              onChange={set("amount")}
              className={`${inputClass} min-w-0 flex-1`}
            />
            <button
              type="button"
              onClick={() => setLines([{ item: "", qty: "", unit_price: "" }])}
              title="拆成品項×數量×單價——材料單價統計靠這裡累積"
              className="shrink-0 rounded-md px-1.5 py-1 text-xs font-semibold text-ink-2 ring-1 ring-line transition-base hover:bg-page"
            >
              拆明細
            </button>
          </div>
        </Field>
      )}

      {/* ★ 算給人看。存檔後才發現少扣保留款，就要走退狀態、填原因那一整套 */}
      {preview.amount > 0 && (
        <dl className="mb-3 space-y-1 rounded-lg bg-page px-3 py-2 text-xs">
          <Line label="金額" value={preview.amount} />
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
          保留款要自己填？
        </summary>
        <div className="mt-2">
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
          <DateInput
            value={form.billing_date}
            onChange={(v) => set("billing_date")({ target: { value: v } })}
          />
        </Field>
        <Field label="預計付款日" hint="留空＝依合約帳期自動算">
          <DateInput value={form.due_date} onChange={(v) => set("due_date")({ target: { value: v } })} />
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
          <p className="mb-2 text-xs font-semibold leading-relaxed" style={{ color: "var(--color-atrisk)" }}>
            開票日不等於兌現日。沒填票期的話，現金流會把這筆錢算成提早兩三個月流出。
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="支票到期日" error={error?.fieldError("check_due_date")}>
              <DateInput
                value={form.check_due_date}
                onChange={(v) => set("check_due_date")({ target: { value: v } })}
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
