/**
 * 新增／修改專案
 *
 * 合約簽下來的那一刻，付款分期就已經知道了——所以**建案時一起填**：
 * 分期照合約抄、合約 PDF 與設計圖直接在表單裡選好，按一次「建立」全部完成。
 * （檔案要掛在案子上，所以實際順序是建案成功後立刻上傳——使用者不必知道這件事）
 *
 * 表單只問必填。合約條款、報價、圖紙連結收進「更多設定」。
 */
import { ChevronDown, Plus, X } from "lucide-react";
import { useState } from "react";

import { ApiError, api } from "@/api/client";
import { useOptions } from "@/api/hooks";
import type { ProjectDetail } from "@/api/types";
import { Button, Field, FormErrors, inputClass, Modal, Select } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

interface MilestoneRow {
  label: string;
  percentage: string;
  expected_date: string;
}

/** 常見的分期模板。點一下帶入，再照合約改 */
const SPLIT_PRESETS: Array<{ key: string; rows: Array<[string, number]> }> = [
  { key: "30/40/30", rows: [["第一期（簽約）", 30], ["第二期（出貨）", 40], ["第三期（驗收）", 30]] },
  { key: "15/25/40/20", rows: [["第一期（簽約）", 15], ["第二期（進料）", 25], ["第三期（出貨安裝）", 40], ["第四期（驗收）", 20]] },
  { key: "50/50", rows: [["第一期（簽約）", 50], ["尾款（驗收）", 50]] },
];

interface FormState {
  name: string;
  project_type: string;
  customer: string;
  owner: string;
  contract_amount: string;
  start_date: string;
  due_date: string;
  note: string;
  contract_terms: string;
  quote_info: string;
  doc_links: string;
}

const EMPTY: FormState = {
  name: "",
  project_type: "steel",
  customer: "",
  owner: "",
  contract_amount: "",
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
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [milestones, setMilestones] = useState<MilestoneRow[]>([]);
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
      project_type: project.project_type,
      customer: project.customer ? String(project.customer.id) : "",
      owner: project.owner ? String(project.owner.id) : "",
      contract_amount: project.contract_amount ?? "",
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
    setContractFiles([]);
    setDrawingFiles([]);
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
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["billing"] });
      qc.invalidateQueries({ queryKey: ["options"] });
      if (project) {
        toast.success(`${saved.name} 已更新`);
        close();
        return;
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
      project_type: form.project_type,
      customer: Number(form.customer),
      owner: Number(form.owner),
      contract_amount: form.contract_amount || "0",
      start_date: form.start_date || null,
      due_date: form.due_date || null,
      note: form.note,
      contract_terms: form.contract_terms,
      quote_info: form.quote_info,
      doc_links: form.doc_links,
      ...(project
        ? {}
        : {
            milestones: milestones
              .filter((m) => m.label.trim() && m.percentage)
              .map((m) => ({
                label: m.label.trim(),
                percentage: m.percentage,
                expected_date: m.expected_date || null,
              })),
          }),
    });
  }

  const totalPct = milestones.reduce((sum, m) => sum + (Number(m.percentage) || 0), 0);

  const set = (key: keyof FormState) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

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
        label="專案類型"
        required
        hint="決定底下能建哪種追蹤單元：鋼構是構件批次（算數量），土建是工項（算百分比）"
      >
        <Select
          value={form.project_type}
          onChange={set("project_type")}
          options={options?.project_type ?? []}
          className="w-full"
        />
      </Field>

      <Field
        label="客戶"
        required
        hint={
          customers.data && customers.data.results.length === 0
            ? "客戶清單是空的。到「設定 → 客戶」新增（限經營者與系統管理員）"
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

      <Field label="合約金額" hint="單位：元。各期金額＝合約額 × 比例，之後可由變更追加單調整">
        <input
          type="number"
          inputMode="numeric"
          value={form.contract_amount}
          onChange={(e) => set("contract_amount")(e.target.value)}
          className={inputClass}
        />
      </Field>

      {!project && (
        <Field
          label="請款分期（照合約抄）"
          hint="合約怎麼寫就怎麼填。金額＝合約額×比例，自動算；之後在專案明細隨時可改"
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
                          label, percentage: String(pct), expected_date: "",
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
                  onClick={() => setMilestones([{ label: "第一期", percentage: "", expected_date: "" }])}
                  className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-ink-3 hover:bg-page"
                >
                  自訂…
                </button>
              </div>
            )}

            {milestones.length > 0 && (
              <div className="space-y-1.5">
                {milestones.map((row, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <input
                      value={row.label}
                      onChange={(e) =>
                        setMilestones((rows) =>
                          rows.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)),
                        )
                      }
                      placeholder="名稱"
                      className={`${inputClass} mb-0 flex-1`}
                    />
                    <input
                      type="number"
                      inputMode="decimal"
                      value={row.percentage}
                      onChange={(e) =>
                        setMilestones((rows) =>
                          rows.map((r, j) => (j === i ? { ...r, percentage: e.target.value } : r)),
                        )
                      }
                      placeholder="%"
                      className={`${inputClass} mb-0 w-16 text-right`}
                    />
                    <input
                      type="date"
                      value={row.expected_date}
                      onChange={(e) =>
                        setMilestones((rows) =>
                          rows.map((r, j) => (j === i ? { ...r, expected_date: e.target.value } : r)),
                        )
                      }
                      title="預計請款日（現金流用，可先留白）"
                      className={`${inputClass} mb-0 w-36`}
                    />
                    <button
                      type="button"
                      onClick={() => setMilestones((rows) => rows.filter((_, j) => j !== i))}
                      aria-label="刪除這一期"
                      className="rounded p-1 text-ink-3 hover:text-[var(--color-delayed)]"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() =>
                      setMilestones((rows) => [
                        ...rows,
                        { label: `第${rows.length + 1}期`, percentage: "", expected_date: "" },
                      ])
                    }
                    className="flex items-center gap-1 rounded px-1.5 py-1 text-xs font-semibold text-ink-2 hover:bg-page"
                  >
                    <Plus size={13} />
                    加一期
                  </button>
                  <span
                    className="text-[11px] font-semibold"
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
          <input
            type="date"
            value={form.start_date}
            onChange={(e) => set("start_date")(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="預計完工" error={error?.fieldError("due_date")}>
          <input
            type="date"
            value={form.due_date}
            onChange={(e) => set("due_date")(e.target.value)}
            className={inputClass}
          />
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

      <FormErrors error={error} handled={["name", "customer", "owner", "due_date"]} />

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
    </Modal>
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
        <span className="text-[11px] font-semibold text-ink-2">{label}</span>
        <label className="cursor-pointer rounded-lg bg-card px-2.5 py-1 text-[11px] font-semibold
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
            <li key={`${file.name}-${i}`} className="flex items-center gap-2 text-[11px] text-ink-2">
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
