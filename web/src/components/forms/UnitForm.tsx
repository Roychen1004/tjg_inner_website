/**
 * 新增／修改追蹤單元
 *
 * ★ 使用者選的是**階段模板**，不是寫死的兩種類型。
 * 在 Admin 建一條新模板，它立刻出現在這個下拉裡——加流程不用改程式。
 *
 * 選了模板之後，問的問題就跟著變：
 *   走構件批次類的模板 → 幾支？（數量）
 *   走土建工項類的模板 → 目前完成幾 %？
 */
import { useState } from "react";

import { ApiError, api } from "@/api/client";
import { useOptions } from "@/api/hooks";
import type { StageTemplate, TrackingDetail } from "@/api/types";
import { Button, DateInput, Field, FormErrors, inputClass, Modal, Select } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const UNITS = ["支", "組", "片", "件", "噸", "式", "m", "m²", "m³"];

interface FormState {
  project: string;
  template: string;
  name: string;
  qty_total: string;
  unit_of_measure: string;
  progress_pct: string;
  subcontractor: string;
  subcontract_amount: string;
  plan_end: string;
  note: string;
}

const EMPTY: FormState = {
  project: "", template: "", name: "",
  qty_total: "", unit_of_measure: "支", progress_pct: "0",
  subcontractor: "", subcontract_amount: "", plan_end: "", note: "",
};

export default function UnitForm({
  open,
  onClose,
  defaultProject,
  unit,
}: {
  open: boolean;
  onClose: () => void;
  defaultProject?: number;
  /** 有值就是編輯模式 */
  unit?: TrackingDetail | null;
}) {
  const { data: options } = useOptions();
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  // 可選的階段模板來自資料庫，不是前端寫死的清單
  const templates = useQuery({
    queryKey: ["stage-templates", "for-units"],
    queryFn: () => api.get<StageTemplate[]>("/stage-templates", { for_units: true }),
    enabled: open,
    staleTime: 10 * 60 * 1000,
  });

  // 分包商下拉（土建工項用）
  const vendors = useQuery({
    queryKey: ["vendors", "subcontractor"],
    queryFn: () =>
      api.get<{ results: Array<{ id: number; name: string }> }>("/vendors", {
        type: "subcontractor", active: true, page_size: 100,
      }),
    enabled: open,
    staleTime: 10 * 60 * 1000,
  });

  // 只剩鋼構模板時自動帶入預設，不用多問一題
  if (open && !unit && !form.template && templates.data?.length) {
    const def = templates.data.find((t) => t.is_default) ?? templates.data[0];
    setForm((f) => ({ ...f, template: String(def.id) }));
  }

  const key = unit ? `edit-${unit.id}` : `new-${defaultProject ?? ""}`;
  if (open && loadedKey !== key) {
    setLoadedKey(key);
    setForm(
      unit
        ? {
            project: String(unit.project),
            template: "",
            name: unit.name,
            qty_total: unit.qty_total ?? "",
            unit_of_measure: unit.unit_of_measure || "支",
            progress_pct: unit.progress_pct ?? "0",
            subcontractor: unit.subcontractor ? String(unit.subcontractor) : "",
            subcontract_amount: "",
            plan_end: unit.plan_end ?? "",
            note: unit.note,
          }
        : { ...EMPTY, project: defaultProject ? String(defaultProject) : "" },
    );
  }
  if (!open && loadedKey !== null) setLoadedKey(null);

  const selected = templates.data?.find((t) => String(t.id) === form.template);
  // 編輯時沿用原本的類型；新增時由選到的模板決定
  const isBatch = unit
    ? unit.unit_type === "batch"
    : selected
      ? selected.applies_to !== "civil_work_item"
      : true;

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      unit
        ? api.patch<TrackingDetail>(`/tracking-units/${unit.id}`, body)
        : api.post<TrackingDetail>("/tracking-units", body),
    onSuccess: async (saved) => {
      const lines = unit
        ? []
        : [`編號 ${saved.code}，起始於「${saved.stage_name}」（共 ${saved.stage_total} 站）`];

      // 填了分包金額就順手建立分包合約——錢的家在「金流 → 應付」，
      // 但輸入的入口跟著工作走：建工項的當下就是知道分包價的時候
      if (!unit && form.subcontractor && form.subcontract_amount) {
        try {
          await api.post("/subcontracts", {
            project: Number(form.project),
            vendor: Number(form.subcontractor),
            title: `${form.name.trim()}（分包）`,
            category: "subcontract",
            contract_amount: form.subcontract_amount,
          });
          lines.push(`分包合約 ${Number(form.subcontract_amount).toLocaleString()} 元已建立，在金流→應付`);
          qc.invalidateQueries({ queryKey: ["subcontracts"] });
          qc.invalidateQueries({ queryKey: ["pnl"] });
        } catch {
          lines.push("⚠️ 分包合約建立失敗，請到專案明細的分包合約區塊補建");
        }
      }

      for (const k of ["tracking-units", "board", "tracking-unit", "project", "projects", "dashboard"]) {
        qc.invalidateQueries({ queryKey: [k] });
      }
      toast.success(unit ? `${saved.name} 已更新` : `已建立「${saved.name}」`, lines);
      close();
    },
  });

  const error = save.error instanceof ApiError ? save.error : null;

  function close() {
    save.reset();
    onClose();
  }

  function submit() {
    const common = {
      name: form.name.trim(),
      subcontractor: form.subcontractor ? Number(form.subcontractor) : null,
      plan_end: form.plan_end || null,
      note: form.note,
      ...(isBatch
        ? { qty_total: form.qty_total, unit_of_measure: form.unit_of_measure }
        : { progress_pct: form.progress_pct }),
    };
    save.mutate(
      unit
        ? common
        : { ...common, project: Number(form.project), template: Number(form.template) },
    );
  }

  const set = (k: keyof FormState) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const grouped = groupTemplates(templates.data ?? []);
  const complete =
    form.name.trim() &&
    (unit || (form.project && form.template)) &&
    (!isBatch || form.qty_total);

  return (
    <Modal open={open} onClose={close} title={unit ? `修改 ${unit.name}` : "新增構件批次"}>
      {!unit && (
        <>
          <Field label="專案" required error={error?.fieldError("project")}>
            <Select
              value={form.project}
              onChange={set("project")}
              options={(options?.projects ?? []).map((p) => ({ value: p.id, label: p.name }))}
              placeholder="請選擇"
              className="w-full"
            />
          </Field>

          {/* 只有一條批次流程時自動帶入，不多問。多條才給選 */}
          {(templates.data?.length ?? 0) > 1 && (
            <Field
              label="階段流程"
              required
              hint={
                selected
                  ? `共 ${selected.stages.length} 站：${selected.stages.map((s) => s.name).join(" → ")}`
                  : "流程是設定出來的，不是寫死的。要新增流程請至 /admin/masters/stagetemplate/"
              }
              error={error?.fieldError("template")}
            >
              <select
                value={form.template}
                onChange={(e) => set("template")(e.target.value)}
                className={inputClass}
              >
                <option value="">請選擇</option>
                {grouped.map(([label, items]) => (
                  <optgroup key={label} label={label}>
                    {items.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}（{t.stages.length} 站）
                        {t.is_default ? " · 預設" : ""}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </Field>
          )}
          {selected && (templates.data?.length ?? 0) <= 1 && (
            <p className="-mt-1 mb-3 text-[11px] leading-relaxed text-ink-3">
              廠內七站：{selected.stages.map((s) => s.name).join(" → ")}
            </p>
          )}
        </>
      )}

      <Field label="名稱" required error={error?.fieldError("name")}>
        <input
          value={form.name}
          onChange={(e) => set("name")(e.target.value)}
          placeholder={isBatch ? "如「第一期-1F鋼柱」" : "如「B區基礎工程」"}
          className={inputClass}
        />
      </Field>

      {isBatch ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="總數量" required error={error?.fieldError("qty_total")}>
              <input
                type="number"
                inputMode="decimal"
                value={form.qty_total}
                onChange={(e) => set("qty_total")(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="單位" required>
              <Select
                value={form.unit_of_measure}
                onChange={set("unit_of_measure")}
                options={UNITS.map((u) => ({ value: u, label: u }))}
                className="w-full"
              />
            </Field>
          </div>
          <p className="-mt-1 mb-3 text-[11px] leading-relaxed text-ink-3">
            這是<strong>整批的總量</strong>。完成度算的是「目前這一站做了幾支」，
            換站會歸零重新算。
          </p>
        </>
      ) : (
        <>
          <Field label="目前這一站的完成度 (%)">
            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              value={form.progress_pct}
              onChange={(e) => set("progress_pct")(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="分包商" hint="做這個工項的是誰">
            <Select
              value={form.subcontractor}
              onChange={set("subcontractor")}
              options={(vendors.data?.results ?? []).map((v) => ({ value: v.id, label: v.name }))}
              placeholder="未指定"
              className="w-full"
            />
          </Field>
          {!unit && form.subcontractor && (
            <Field
              label="分包金額（未稅）"
              hint="填了會自動建立分包合約（金流→應付），這個案子的成本從此算得出來。之後包商每期送單，在那裡登錄計價"
            >
              <input
                type="number"
                inputMode="numeric"
                value={form.subcontract_amount}
                onChange={(e) => set("subcontract_amount")(e.target.value)}
                className={inputClass}
              />
            </Field>
          )}
        </>
      )}

      <Field label="預計完成">
        <DateInput value={form.plan_end} onChange={set("plan_end")} />
      </Field>

      <Field label="備註">
        <input value={form.note} onChange={(e) => set("note")(e.target.value)} className={inputClass} />
      </Field>

      <FormErrors error={error} handled={["project", "template", "name", "qty_total"]} />

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
          {unit ? "儲存" : "建立"}
        </Button>
      </div>
    </Modal>
  );
}

const APPLIES_LABEL: Record<string, string> = {
  steel_batch: "構件批次（用數量計進度）",
  civil_work_item: "土建工項（用百分比計進度）",
};

function groupTemplates(templates: StageTemplate[]): Array<[string, StageTemplate[]]> {
  const map = new Map<string, StageTemplate[]>();
  for (const t of templates) {
    const label = APPLIES_LABEL[t.applies_to] ?? t.applies_to;
    map.set(label, [...(map.get(label) ?? []), t]);
  }
  return [...map.entries()];
}
