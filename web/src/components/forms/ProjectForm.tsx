/**
 * 新增／修改專案
 *
 * 建案一頁完成（2026-08 流程制）：
 *   · 勾流程——五大階段 19 項預設全勾，把不需要的取消；每勾一項生成一張流程單元
 *   · 填分期——照合約抄，每期可掛「觸發流程」：該流程完成 → 自動轉可請款
 *   · 選檔案——合約 PDF 與設計圖，按一次「建立」全部完成
 *
 * 從詢價就建案：還沒簽約可以只填「估價金額」，金流預測會用它（預估級）。
 * 表單只問必填。合約條款、報價、圖紙連結收進「更多設定」。
 */
import { ChevronDown, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import { ApiError, api } from "@/api/client";
import { useFlowCatalog, useFlowTemplates, useOptions } from "@/api/hooks";
import { useCurrentUser } from "@/api/hooks/useAuth";
import type { FlowUnit, ProjectDetail } from "@/api/types";
import FlowArranger, { entriesFromCatalog, type FlowEntry } from "@/components/forms/FlowArranger";
import { Button, DateInput, Field, FormErrors, inputClass, Modal, Select } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

interface MilestoneRow {
  label: string;
  percentage: string;
  expected_date: string;
  /** 觸發流程的目錄 id（字串存放）。該流程完成→這一期自動可請款 */
  trigger: string;
}

/** 常見的分期模板。點一下帶入，再照合約改 */
const SPLIT_PRESETS: Array<{ key: string; rows: Array<[string, number]> }> = [
  { key: "30/40/30", rows: [["第一期（簽約）", 30], ["第二期（出貨）", 40], ["第三期（驗收）", 30]] },
  { key: "15/25/40/20", rows: [["第一期（簽約）", 15], ["第二期（進料）", 25], ["第三期（出貨安裝）", 40], ["第四期（驗收）", 20]] },
  { key: "50/50", rows: [["第一期（簽約）", 50], ["尾款（驗收）", 50]] },
];

interface FormState {
  name: string;
  customer: string;
  owner: string;
  contract_amount: string;
  estimate_amount: string;
  lifecycle: string;
  start_date: string;
  due_date: string;
  note: string;
  contract_terms: string;
  quote_info: string;
  doc_links: string;
}

const EMPTY: FormState = {
  name: "",
  customer: "",
  owner: "",
  contract_amount: "",
  estimate_amount: "",
  lifecycle: "active",
  start_date: "",
  due_date: "",
  note: "",
  contract_terms: "",
  quote_info: "",
  doc_links: "",
};

export default function ProjectForm({
  open,
  onClose,
  project,
}: {
  open: boolean;
  onClose: () => void;
  project?: ProjectDetail | null;
}) {
  const { data: options } = useOptions();
  const { data: templates } = useFlowTemplates();
  // D49：先選流程模板，再依模板的目錄編排這個案子的流程
  const [template, setTemplate] = useState<string>("");
  const templateId = template ? Number(template) : null;
  const { data: catalog } = useFlowCatalog(open, templateId);
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [milestones, setMilestones] = useState<MilestoneRow[]>([]);
  const [entries, setEntries] = useState<FlowEntry[] | null>(null);
  const [seededFor, setSeededFor] = useState<string>("");
  const [more, setMore] = useState(false);
  const [loadedId, setLoadedId] = useState<number | null>(null);
  // 建案時一起選好的檔案，存檔成功後自動上傳
  const [contractFiles, setContractFiles] = useState<File[]>([]);
  const [drawingFiles, setDrawingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);

  // 開啟編輯時帶入現值
  if (open && project && loadedId !== project.id) {
    setLoadedId(project.id);
    setForm({
      name: project.name,
      customer: project.customer ? String(project.customer.id) : "",
      owner: project.owner ? String(project.owner.id) : "",
      contract_amount: project.contract_amount ?? "",
      estimate_amount: project.estimate_amount ?? "",
      lifecycle: project.lifecycle,
      start_date: project.start_date ?? "",
      due_date: project.due_date ?? "",
      note: project.note,
      contract_terms: project.contract_terms,
      quote_info: project.quote_info,
      doc_links: project.doc_links,
    });
  }
  if (open && !project && loadedId !== null) {
    setLoadedId(null);
    setForm(EMPTY);
    setMilestones([]);
    setEntries(null);
    setSeededFor("");
    setContractFiles([]);
    setDrawingFiles([]);
  }
  // 模板下拉預設選「預設模板」
  if (open && !project && !template && templates?.length) {
    const def = templates.find((t) => t.is_default) ?? templates[0];
    setTemplate(String(def.id));
  }
  // 目錄載入（或換模板）後重建編排清單：預設全勾（老闆確認過：預設全勾再取消）
  const seedKey = `${template}|${catalog ? "y" : "n"}`;
  if (open && !project && catalog && seededFor !== seedKey) {
    setSeededFor(seedKey);
    setEntries(entriesFromCatalog(catalog));
  }

  const customers = useQuery({
    queryKey: ["customers"],
    queryFn: () => api.get<{ results: Array<{ id: number; name: string }> }>("/customers", {
        active: "true",
        page_size: 100,
      }),
    enabled: open,
    staleTime: 10 * 60 * 1000,
  });

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      project
        ? api.patch<ProjectDetail>(`/projects/${project.id}`, body)
        : api.post<ProjectDetail>("/projects", body),
    onSuccess: async (saved) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["project"] });
      qc.invalidateQueries({ queryKey: ["flow-units"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["billing"] });
      qc.invalidateQueries({ queryKey: ["cashflow"] });
      qc.invalidateQueries({ queryKey: ["options"] });
      if (project) {
        toast.success(`${saved.name} 已更新`);
        close();
        return;
      }

      // D49：自訂流程與拖移後的順序，在案子建立後補上
      const included = (entries ?? []).filter((e) => e.included);
      const customs = included.filter((e) => e.isCustom);
      const catalogOrderChanged = (() => {
        const seqOf = new Map(
          (catalog ?? []).flatMap((s) => s.items).map((i) => [i.id, i.seq]),
        );
        const items = included.filter((e) => e.itemId !== null);
        for (let i = 1; i < items.length; i++) {
          const a = seqOf.get(items[i - 1].itemId as number) ?? 0;
          const b = seqOf.get(items[i].itemId as number) ?? 0;
          if (a > b) return true;
        }
        return false;
      })();
      if (customs.length || catalogOrderChanged) {
        const stageIdBySeq = new Map((catalog ?? []).map((s) => [s.seq, s.id]));
        const createdByKey = new Map<string, number>();
        try {
          for (const e of customs) {
            const stageId = stageIdBySeq.get(e.stageSeq);
            if (!stageId) continue;
            const unit = await api.post<FlowUnit>(`/projects/${saved.id}/add-flow`, {
              name: e.name,
              stage: stageId,
            });
            createdByKey.set(e.key, unit.id);
          }
          const unitByItem = new Map(
            saved.flow_units
              .filter((u) => u.flow_item !== null)
              .map((u) => [u.flow_item as number, u.id]),
          );
          const orderedIds = included
            .map((e) =>
              e.itemId !== null
                ? unitByItem.get(e.itemId) ?? null
                : createdByKey.get(e.key) ?? null,
            )
            .filter((id): id is number => id !== null);
          await api.post(`/projects/${saved.id}/reorder-flows`, { unit_ids: orderedIds });
          qc.invalidateQueries({ queryKey: ["flow-units"] });
          qc.invalidateQueries({ queryKey: ["project"] });
        } catch {
          toast.error("案子已建立，但自訂流程或順序沒存成功", [
            "到專案明細的「編輯流程」再調一次即可",
          ]);
        }
      }

      // 表單裡選好的合約與圖說，掛到剛建立的案子上
      const files: Array<[File, string]> = [
        ...contractFiles.map((f): [File, string] => [f, "contract"]),
        ...drawingFiles.map((f): [File, string] => [f, "drawing"]),
      ];
      const failed: string[] = [];
      if (files.length) {
        setUploading(true);
        for (const [file, category] of files) {
          const formData = new FormData();
          formData.append("file", file);
          formData.append("target", "project");
          formData.append("id", String(saved.id));
          formData.append("category", category);
          try {
            await api.upload("/attachments", formData);
          } catch {
            failed.push(file.name);
          }
        }
        setUploading(false);
        qc.invalidateQueries({ queryKey: ["attachments"] });
      }

      if (failed.length) {
        toast.error(`「${saved.name}」已建立，但 ${failed.join("、")} 上傳失敗`, [
          "到專案明細的檔案區重傳即可",
        ]);
      } else {
        toast.success(`已建立「${saved.name}」`, [
          `編號 ${saved.code}`,
          included.length
            ? `${included.length} 個流程單元已生成，到專案明細指派負責人與排期`
            : "",
          milestones.length ? `${milestones.length} 期應收款` : "",
          files.length ? `${files.length} 個檔案已上傳` : "",
        ].filter(Boolean));
      }
      close();
    },
  });

  const error = save.error instanceof ApiError ? save.error : null;

  function close() {
    save.reset();
    setMore(false);
    onClose();
  }

  const complete = form.name.trim() && form.customer && form.owner;

  function submit() {
    save.mutate({
      name: form.name.trim(),
      customer: Number(form.customer),
      owner: Number(form.owner),
      contract_amount: form.contract_amount || "0",
      estimate_amount: form.estimate_amount || null,
      lifecycle: form.lifecycle,
      start_date: form.start_date || null,
      due_date: form.due_date || null,
      note: form.note,
      contract_terms: form.contract_terms,
      quote_info: form.quote_info,
      doc_links: form.doc_links,
      ...(project
        ? {}
        : {
            flow_items: (entries ?? [])
              .filter((e) => e.included && e.itemId !== null)
              .map((e) => e.itemId as number),
            milestones: milestones
              .filter((m) => m.label.trim() && m.percentage)
              .map((m) => ({
                label: m.label.trim(),
                percentage: m.percentage,
                expected_date: m.expected_date || null,
                trigger_flow_item: m.trigger ? Number(m.trigger) : null,
              })),
          }),
    });
  }

  const totalPct = milestones.reduce((sum, m) => sum + (Number(m.percentage) || 0), 0);

  const set = (key: keyof FormState) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  // 分期可掛的觸發流程＝目前勾選中的目錄流程（自訂流程建案後在卡片上掛）。
  // 編號是位置制（D51）會隨拖移變動，下拉只顯示名稱
  const triggerOptions = (entries ?? [])
    .filter((e) => e.included && e.itemId !== null)
    .map((e) => ({ value: String(e.itemId), label: e.name }));

  return (
    <Modal open={open} onClose={close} title={project ? "修改專案" : "新增專案"}>
      <Field label="案名" required error={error?.fieldError("name")}>
        <input
          value={form.name}
          onChange={(e) => set("name")(e.target.value)}
          placeholder="如「固越企業總部案」"
          className={inputClass}
        />
      </Field>

      <Field
        label="客戶"
        required
        hint={
          customers.data && customers.data.results.length === 0
            ? "客戶清單是空的。到「設定 → 客戶」新增（限經理與系統管理員）"
            : undefined
        }
        error={error?.fieldError("customer")}
      >
        <Select
          value={form.customer}
          onChange={set("customer")}
          options={(customers.data?.results ?? []).map((c) => ({ value: c.id, label: c.name }))}
          placeholder="請選擇"
          className="w-full"
        />
      </Field>

      <Field
        label="專案負責人"
        required
        error={error?.fieldError("owner")}
      >
        <Select
          value={form.owner}
          onChange={set("owner")}
          options={(options?.users ?? []).map((u) => ({ value: u.id, label: u.name }))}
          placeholder="請選擇"
          className="w-full"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="合約金額" hint="簽約後填。各期金額＝合約額×比例" error={error?.fieldError("contract_amount")}>
          <input
            type="number"
            inputMode="numeric"
            value={form.contract_amount}
            onChange={(e) => set("contract_amount")(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="估價金額" hint="還沒簽約先填這個，金流預測用（預估級）" error={error?.fieldError("estimate_amount")}>
          <input
            type="number"
            inputMode="numeric"
            value={form.estimate_amount}
            onChange={(e) => set("estimate_amount")(e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      {project && (
        <Field
          label="案件狀態"
          hint="未成交／暫停的案子不進金流預測；結案直接在這裡改成「已結案」"
        >
          <Select
            value={form.lifecycle}
            onChange={set("lifecycle")}
            options={options?.project_lifecycle ?? []}
            className="w-full"
          />
        </Field>
      )}

      {!project && (
        // 不用 Field 包——FlowArranger 內部有自己的 label，巢狀 label 會互相搶點擊
        <div className="mb-3">
          <div className="mb-1 flex items-center gap-2">
            <p className="text-xs font-semibold text-ink-2">這個案子要走哪些流程</p>
            {/* 流程模板（D49）：不同型態的案子有不同的起手目錄。內容在 設定 → 流程模板 維護 */}
            {(templates?.length ?? 0) > 1 && (
              <Select
                value={template}
                onChange={setTemplate}
                options={(templates ?? []).map((t) => ({
                  value: t.id,
                  label: t.is_default ? `${t.name}（預設）` : t.name,
                }))}
                className="ml-auto"
              />
            )}
          </div>
          {catalog && entries ? (
            <FlowArranger stages={catalog} entries={entries} onChange={setEntries} />
          ) : (
            <p className="text-xs text-ink-3">載入流程目錄…</p>
          )}
        </div>
      )}

      {!project && (
        <Field
          label="請款分期（照合約抄）"
          hint="每期可掛「觸發流程」：該流程完成，系統自動把那一期轉成可請款並通知"
        >
          <div>
            {milestones.length === 0 && (
              <div className="flex flex-wrap gap-1.5">
                {SPLIT_PRESETS.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={() =>
                      setMilestones(
                        preset.rows.map(([label, pct]) => ({
                          label, percentage: String(pct), expected_date: "", trigger: "",
                        })),
                      )
                    }
                    className="rounded-lg bg-page px-2.5 py-1.5 text-xs font-semibold text-ink-2
                               ring-1 ring-line hover:ring-stage-2"
                  >
                    {preset.key}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    setMilestones([{ label: "第一期", percentage: "", expected_date: "", trigger: "" }])
                  }
                  className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-ink-3 hover:bg-page"
                >
                  自訂…
                </button>
              </div>
            )}

            {milestones.length > 0 && (
              <div className="space-y-2">
                {milestones.map((row, i) => (
                  <div key={i} className="rounded-lg bg-page p-2">
                    <div className="flex items-center gap-1.5">
                      <input
                        value={row.label}
                        onChange={(e) =>
                          setMilestones((rows) =>
                            rows.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)),
                          )
                        }
                        placeholder="期別名稱（如：第一期（簽約））"
                        className={`${inputClass} mb-0 min-w-0 flex-1`}
                      />
                      <label className="flex shrink-0 items-center gap-1 text-xs text-ink-3">
                        <input
                          type="number"
                          inputMode="decimal"
                          value={row.percentage}
                          onChange={(e) =>
                            setMilestones((rows) =>
                              rows.map((r, j) => (j === i ? { ...r, percentage: e.target.value } : r)),
                            )
                          }
                          placeholder="比例"
                          aria-label="比例（%）"
                          className={`${inputClass} mb-0 w-16 text-right`}
                        />
                        %
                      </label>
                      <button
                        type="button"
                        onClick={() => setMilestones((rows) => rows.filter((_, j) => j !== i))}
                        aria-label="刪除這一期"
                        className="rounded p-1 text-ink-3 hover:text-[var(--color-delayed)]"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    {/* 觸發流程與日期各佔一行（D47）——擠同一排會被壓到看不出是什麼 */}
                    <select
                      value={row.trigger}
                      onChange={(e) =>
                        setMilestones((rows) =>
                          rows.map((r, j) => (j === i ? { ...r, trigger: e.target.value } : r)),
                        )
                      }
                      title="觸發流程：完成後這一期自動轉可請款"
                      className={`${inputClass} mb-0 mt-1.5`}
                    >
                      <option value="">不掛觸發流程（手動轉可請款）</option>
                      {triggerOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          完成「{o.label}」→ 可請款
                        </option>
                      ))}
                    </select>
                    <label className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-3">
                      <span className="shrink-0">預計請款日（現金流用，可留白）</span>
                      <DateInput
                        value={row.expected_date}
                        onChange={(v) =>
                          setMilestones((rows) =>
                            rows.map((r, j) => (j === i ? { ...r, expected_date: v } : r)),
                          )
                        }
                        className="min-w-0 flex-1"
                        aria-label="預計請款日"
                      />
                    </label>
                  </div>
                ))}
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() =>
                      setMilestones((rows) => [
                        ...rows,
                        { label: `第${rows.length + 1}期`, percentage: "", expected_date: "", trigger: "" },
                      ])
                    }
                    className="flex items-center gap-1 rounded px-1.5 py-1 text-xs font-semibold text-ink-2 hover:bg-page"
                  >
                    <Plus size={13} />
                    加一期
                  </button>
                  <span
                    className="text-xs font-semibold"
                    style={{ color: totalPct === 100 ? "var(--color-ontrack)" : "var(--color-atrisk)" }}
                  >
                    合計 {totalPct}%
                  </span>
                </div>
              </div>
            )}
          </div>
        </Field>
      )}

      {!project && (
        <Field
          label="合約與設計圖"
          hint="現在選好，按「建立」一次完成。之後在專案明細也隨時能補"
        >
          <div className="space-y-2">
            <FilePicker
              label="合約（PDF）"
              accept=".pdf"
              files={contractFiles}
              onChange={setContractFiles}
            />
            <FilePicker
              label="設計圖／圖說（PDF、照片、DWG）"
              accept=".pdf,.png,.jpg,.jpeg,.dwg"
              files={drawingFiles}
              onChange={setDrawingFiles}
            />
          </div>
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="開工日">
          <DateInput value={form.start_date} onChange={set("start_date")} />
        </Field>
        <Field label="預計完工" error={error?.fieldError("due_date")}>
          <DateInput value={form.due_date} onChange={set("due_date")} />
        </Field>
      </div>

      <button
        type="button"
        onClick={() => setMore((v) => !v)}
        className="mb-3 flex w-full items-center justify-between rounded-lg bg-page px-3 py-2
                   text-xs font-semibold text-ink-2"
      >
        更多設定（合約條款、報價、圖紙連結）
        <ChevronDown size={14} className={more ? "rotate-180" : ""} />
      </button>

      {more && (
        <>
          <Field label="合約條款" hint="工期、請款條件、罰則、保固">
            <textarea
              rows={3}
              value={form.contract_terms}
              onChange={(e) => set("contract_terms")(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="報價資訊">
            <textarea
              rows={2}
              value={form.quote_info}
              onChange={(e) => set("quote_info")(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="文件連結" hint="圖紙雲端連結、聯絡窗口">
            <textarea
              rows={2}
              value={form.doc_links}
              onChange={(e) => set("doc_links")(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="備註">
            <input
              value={form.note}
              onChange={(e) => set("note")(e.target.value)}
              className={inputClass}
            />
          </Field>
        </>
      )}

      <FormErrors error={error} handled={["name", "customer", "owner", "due_date", "contract_amount", "estimate_amount"]} />

      <div className="flex gap-2">
        <Button onClick={close} className="flex-1">
          取消
        </Button>
        <Button
          variant="primary"
          onClick={submit}
          loading={save.isPending || uploading}
          disabled={!complete}
          className="flex-1"
        >
          {uploading ? "上傳檔案中…" : project ? "儲存" : "建立專案"}
        </Button>
      </div>

      {project && <DeleteProjectZone project={project} onDeleted={close} />}
    </Modal>
  );
}

/**
 * 刪專案——只有經理看得到（delete_project 權限）。
 * 兩段式確認；已有請款／收款紀錄或掛著應付款的案子後端會擋，
 * 錯誤訊息會說該改走「案件狀態」。
 */
function DeleteProjectZone({
  project,
  onDeleted,
}: {
  project: ProjectDetail;
  onDeleted: () => void;
}) {
  const { data: user } = useCurrentUser();
  const toast = useToast();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [confirming, setConfirming] = useState(false);

  const remove = useMutation({
    mutationFn: () => api.delete<void>(`/projects/${project.id}`),
    onSuccess: () => {
      // 展開中的就是被刪的案子——收掉，不然明細會打 404
      if (searchParams.get("open") === String(project.id)) {
        const next = new URLSearchParams(searchParams);
        next.delete("open");
        setSearchParams(next, { replace: true });
      }
      qc.invalidateQueries();
      toast.success(`已刪除「${project.name}」`);
      onDeleted();
    },
    onError: (e) =>
      toast.error(
        e instanceof ApiError ? e.body.detail ?? "刪除失敗" : "刪除失敗",
      ),
  });

  if (!user?.permissions.delete_project) return null;

  return (
    <div className="mt-4 border-t border-line pt-3">
      {confirming ? (
        <div className="rounded-lg px-3 py-2.5" style={{ background: "var(--color-delayed-bg)" }}>
          <p className="text-xs font-semibold" style={{ color: "var(--color-delayed)" }}>
            確定刪除「{project.name}」？
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-2">
            流程單元、構件批次、應收分期、變更單與附件會一起刪除，<strong>不能復原</strong>。
            只是不做了的案子，改「案件狀態」就好，不用刪。
          </p>
          <div className="mt-2 flex gap-2">
            <Button onClick={() => setConfirming(false)} className="flex-1">
              留著
            </Button>
            <Button
              variant="danger"
              onClick={() => remove.mutate()}
              loading={remove.isPending}
              className="flex-1"
            >
              確認刪除
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="flex items-center gap-1 rounded px-1.5 py-1 text-xs font-semibold text-ink-3
                     transition-base hover:text-[var(--color-delayed)]"
        >
          <Trash2 size={12} />
          刪除專案（建錯的才刪；不做了改案件狀態）
        </button>
      )}
    </div>
  );
}

/** 表單內的檔案選擇器：選了先列出來，按「建立」才真的上傳 */
function FilePicker({
  label,
  accept,
  files,
  onChange,
}: {
  label: string;
  accept: string;
  files: File[];
  onChange: (files: File[]) => void;
}) {
  return (
    <div className="rounded-lg bg-page px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-ink-2">{label}</span>
        <label className="cursor-pointer rounded-lg bg-card px-2.5 py-1 text-xs font-semibold
                          text-ink-2 ring-1 ring-line hover:ring-stage-2">
          選檔案
          <input
            type="file"
            multiple
            accept={accept}
            className="hidden"
            onChange={(e) => {
              onChange([...files, ...Array.from(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {files.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {files.map((file, i) => (
            <li key={`${file.name}-${i}`} className="flex items-center gap-2 text-xs text-ink-2">
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <span className="shrink-0 text-ink-3">{(file.size / 1024).toFixed(0)} KB</span>
              <button
                type="button"
                aria-label={`移除 ${file.name}`}
                onClick={() => onChange(files.filter((_, j) => j !== i))}
                className="shrink-0 rounded p-0.5 text-ink-3 hover:text-[var(--color-delayed)]"
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
