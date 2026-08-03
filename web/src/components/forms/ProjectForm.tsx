/**
 * 新增／修改專案
 *
 * 表單只問必填。合約條款、報價、圖紙連結收進「更多設定」——
 * 建案的當下通常只知道案名與客戶，其餘之後再補。
 * 一開始就要求填十五個欄位，結果是大家亂填。
 */
import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { ApiError, api } from "@/api/client";
import { useOptions } from "@/api/hooks";
import type { ProjectDetail } from "@/api/types";
import { Button, Field, FormErrors, inputClass, Modal, Select } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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
  const [more, setMore] = useState(false);
  const [loadedId, setLoadedId] = useState<number | null>(null);

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
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["project"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["options"] });
      toast.success(project ? `${saved.name} 已更新` : `已建立「${saved.name}」`, [
        project ? "" : `編號 ${saved.code}，主線起始於「${saved.main_stage_name}」`,
      ].filter(Boolean));
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
    });
  }

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
        hint="決定底下能建哪種追蹤單元：鋼構走 9 階段構件批次，土建走 5 階段工項"
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
        hint="★ 負責人決定誰看得到這個案子的金額。其他專案負責人看不到"
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

      <Field label="合約金額" hint="單位：元。里程碑金額＝合約額 × 比例，之後可由變更追加單調整">
        <input
          type="number"
          inputMode="numeric"
          value={form.contract_amount}
          onChange={(e) => set("contract_amount")(e.target.value)}
          className={inputClass}
        />
      </Field>

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
          loading={save.isPending}
          disabled={!complete}
          className="flex-1"
        >
          {project ? "儲存" : "建立專案"}
        </Button>
      </div>
    </Modal>
  );
}
