/**
 * 新增／修改追蹤單元
 *
 * ★ 使用者選的是**階段模板**，不是寫死的兩種類型。
 * 系統管理員在 Admin 建一條新模板（例如「鋼構－免表面處理 7 站」），
 * 它立刻出現在這個下拉裡——加流程不用改程式、不用重新部署。
 *
 * 選了模板之後，問的問題就跟著變：
 *   走構件批次類的模板 → 幾支？幾噸？（數量與重量）
 *   走土建工項類的模板 → 目前完成幾 %？
 */
import { useState } from "react";

import { ApiError, api } from "@/api/client";
import { useOptions } from "@/api/hooks";
import { useCurrentUser } from "@/api/hooks/useAuth";
import type { StageTemplate, TrackingDetail } from "@/api/types";
import { Button, Field, FormErrors, inputClass, Modal, Select } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const UNITS = ["支", "組", "片", "件", "噸", "式", "m", "m²", "m³"];

interface FormState {
  project: string;
  phase: string;
  template: string;
  name: string;
  assignee: string;
  qty_total: string;
  unit_of_measure: string;
  total_weight_kg: string;
  progress_pct: string;
  work_mode: string;
  outsource_vendor: string;
  outsource_due_date: string;
  plan_end: string;
  note: string;
}

const EMPTY: FormState = {
  project: "", phase: "", template: "", name: "", assignee: "",
  qty_total: "", unit_of_measure: "支", total_weight_kg: "", progress_pct: "0",
  work_mode: "self", outsource_vendor: "", outsource_due_date: "", plan_end: "", note: "",
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
  const { data: user } = useCurrentUser();
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

  const key = unit ? `edit-${unit.id}` : `new-${defaultProject ?? ""}`;
  if (open && loadedKey !== key) {
    setLoadedKey(key);
    setForm(
      unit
        ? {
            project: String(unit.project),
            phase: unit.phase ? String(unit.phase) : "",
            template: "",
            name: unit.name,
            assignee: unit.assignee ? String(unit.assignee.id) : "",
            qty_total: unit.qty_total ?? "",
            unit_of_measure: unit.unit_of_measure || "支",
            total_weight_kg: unit.total_weight_kg ?? "",
            progress_pct: unit.progress_pct ?? "0",
            work_mode: unit.work_mode,
            outsource_vendor: "",
            outsource_due_date: unit.outsource_due_date ?? "",
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
  const canEditWeight = Boolean(user?.permissions.edit_weight);
  const projectId = form.project ? Number(form.project) : null;

  // 期別決定簽收時觸發哪一筆請款里程碑，所以要跟著專案帶出來
  const detail = useQuery({
    queryKey: ["project", projectId],
    queryFn: () =>
      api.get<{ phases: Array<{ id: number; name: string }> }>(`/projects/${projectId}`),
    enabled: open && projectId !== null,
  });

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      unit
        ? api.patch<TrackingDetail>(`/tracking-units/${unit.id}`, body)
        : api.post<TrackingDetail>("/tracking-units", body),
    onSuccess: (saved) => {
      for (const k of ["tracking-units", "board", "tracking-unit", "project", "projects", "dashboard", "my-work"]) {
        qc.invalidateQueries({ queryKey: [k] });
      }
      toast.success(
        unit ? `${saved.name} 已更新` : `已建立「${saved.name}」`,
        unit ? [] : [`編號 ${saved.code}，起始於「${saved.stage_name}」（共 ${saved.stage_total} 站）`],
      );
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
      phase: form.phase ? Number(form.phase) : null,
      name: form.name.trim(),
      assignee: form.assignee ? Number(form.assignee) : null,
      work_mode: form.work_mode,
      outsource_vendor: form.outsource_vendor ? Number(form.outsource_vendor) : null,
      outsource_due_date: form.outsource_due_date || null,
      plan_end: form.plan_end || null,
      note: form.note,
      ...(isBatch
        ? {
            qty_total: form.qty_total,
            unit_of_measure: form.unit_of_measure,
            ...(canEditWeight && form.total_weight_kg
              ? { total_weight_kg: form.total_weight_kg }
              : {}),
          }
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
    <Modal open={open} onClose={close} title={unit ? `修改 ${unit.name}` : "新增追蹤單元"}>
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
        </>
      )}

      {projectId !== null &&
        (detail.data?.phases?.length ? (
          <Field
            label="期別（標段）"
            hint="這是【工程的分期】，不是分期付款。合約寫「第一期全數簽收後請款」時，系統靠它判斷哪些批次算第一期"
          >
            <Select
              value={form.phase}
              onChange={set("phase")}
              options={detail.data.phases.map((p) => ({ value: p.id, label: p.name }))}
              placeholder="不分期（以全案為範圍）"
              className="w-full"
            />
          </Field>
        ) : (
          <p className="mb-3 rounded-lg bg-page px-3 py-2 text-[11px] leading-relaxed text-ink-2">
            這個專案還沒有分期。若合約是分期請款（第一期／第二期…），
            請到<strong>專案頁展開該案 → 期別</strong>建立，建好後這裡就會出現選項。
          </p>
        ))}

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
            換站會歸零重新算——24 支在「加工」做完，到「品檢」是要重新檢 24 支。
          </p>

          <Field
            label="總重量 (kg)"
            hint={
              canEditWeight
                ? "★ 分批請款的計算基數。首次觸發後會被鎖定，之後要改必須綁變更追加單"
                : "你的角色不能填總重量（決策 D19：職能分離）。請由廠長或專案負責人填寫"
            }
            error={error?.fieldError("total_weight_kg")}
          >
            <input
              type="number"
              inputMode="decimal"
              value={form.total_weight_kg}
              onChange={(e) => set("total_weight_kg")(e.target.value)}
              disabled={!canEditWeight}
              className={inputClass}
            />
          </Field>
        </>
      ) : (
        <Field label="目前這一站的完成度 (%)" hint="土建以監造查驗通過的完成度為準">
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
      )}

      <Field label="指派給" hint="被指派的人會在「我的工作」看到這一筆">
        <Select
          value={form.assignee}
          onChange={set("assignee")}
          options={(options?.users ?? []).map((u) => ({ value: u.id, label: u.name }))}
          placeholder="未指派"
          className="w-full"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="施作方式">
          <Select
            value={form.work_mode}
            onChange={set("work_mode")}
            options={options?.work_mode ?? []}
            className="w-full"
          />
        </Field>
        <Field label="預計完成">
          <input
            type="date"
            value={form.plan_end}
            onChange={(e) => set("plan_end")(e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      {form.work_mode === "outsource" && (
        <Field label="預計出廠日" hint="超過這一天還沒回廠，會出現在「需要關注」">
          <input
            type="date"
            value={form.outsource_due_date}
            onChange={(e) => set("outsource_due_date")(e.target.value)}
            className={inputClass}
          />
        </Field>
      )}

      <Field label="備註">
        <input value={form.note} onChange={(e) => set("note")(e.target.value)} className={inputClass} />
      </Field>

      <FormErrors
        error={error}
        handled={["project", "template", "name", "qty_total", "total_weight_kg"]}
      />

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
