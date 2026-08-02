/**
 * 新增／修改請款里程碑
 *
 * 里程碑就是**合約上寫的那一條請款條件**。
 * 沒有里程碑，請款頁就是空的——簽收再多批也不會有錢跑出來，
 * 因為系統不知道「什麼情況算可以請款」。
 *
 * 表單的核心是「觸發方式」：合約怎麼寫，這裡就怎麼選。
 */
import { useState } from "react";

import { ApiError, api } from "@/api/client";
import { useOptions } from "@/api/hooks";
import type { Milestone } from "@/api/types";
import { phaseName } from "@/lib/naming";
import { Button, Field, FormErrors, inputClass, Modal, Select } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/** 每種觸發方式在合約上長什麼樣。選錯了整條請款邏輯就錯，所以講清楚 */
const TRIGGER_HELP: Record<string, { desc: string; example: string }> = {
  manual: {
    desc: "系統不自動判斷，由會計自己按「建立請款」",
    example: "如「簽約後三日內支付訂金」——系統看不到合約簽了沒",
  },
  all_signed: {
    desc: "該期所有批次都被業主簽收後，整筆轉可請款",
    example: "如「第一期構件全數運抵工地並經業主簽收後請款」",
  },
  weight_threshold: {
    desc: "該期累計簽收噸數佔比達到門檻後，整筆轉可請款",
    example: "如「累計交貨達 80% 得請領該期款項」",
  },
  per_batch: {
    desc: "每一批簽收就產生一筆，金額按該批噸數佔該期的比例分攤",
    example: "如「按實際交貨數量計價，分批請領」",
  },
};

interface FormState {
  project: string;
  phase: string;
  seq: string;
  label: string;
  trigger_desc: string;
  percentage: string;
  trigger_type: string;
  threshold_pct: string;
  target_location: string;
  note: string;
}

const EMPTY: FormState = {
  project: "", phase: "", seq: "1", label: "", trigger_desc: "",
  percentage: "", trigger_type: "manual", threshold_pct: "",
  target_location: "", note: "",
};

export default function MilestoneForm({
  open,
  onClose,
  milestone,
  defaultProject,
}: {
  open: boolean;
  onClose: () => void;
  milestone?: Milestone | null;
  defaultProject?: number;
}) {
  const { data: options } = useOptions();
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  // 使用者自己打過名稱就不再覆蓋——自動帶入是幫忙，不是搶方向盤
  const [nameTouched, setNameTouched] = useState(false);

  const key = milestone ? `edit-${milestone.id}` : `new-${defaultProject ?? ""}`;
  if (open && loadedKey !== key) {
    setLoadedKey(key);
    setNameTouched(Boolean(milestone));
    setForm(
      milestone
        ? {
            project: String(milestone.project),
            phase: milestone.phase ? String(milestone.phase) : "",
            seq: String(milestone.seq),
            label: milestone.label,
            trigger_desc: milestone.trigger_desc,
            percentage: milestone.percentage,
            trigger_type: milestone.trigger_type,
            threshold_pct: milestone.threshold_pct ?? "",
            target_location: "",
            note: milestone.note,
          }
        : { ...EMPTY, project: defaultProject ? String(defaultProject) : "" },
    );
  }
  if (!open && loadedKey !== null) setLoadedKey(null);

  const projectId = form.project ? Number(form.project) : null;

  const detail = useQuery({
    queryKey: ["project", projectId],
    queryFn: () =>
      api.get<{
        phases: Array<{ id: number; name: string }>;
        effective_amount: string | null;
      }>(`/projects/${projectId}`),
    enabled: open && projectId !== null,
  });

  // 同一專案的順序不能重複。與其讓使用者踩到再看錯誤，不如直接帶好下一個號
  const siblings = useQuery({
    queryKey: ["billing", "milestones", { project: projectId }],
    queryFn: () =>
      api.get<{ results: Array<{ seq: number }> }>("/billing-milestones", {
        project: projectId!,
        page_size: 100,
      }),
    enabled: open && projectId !== null,
  });

  const nextSeq = siblings.data
    ? Math.max(0, ...siblings.data.results.map((m) => m.seq)) + 1
    : null;

  // 新增模式下，選了專案就把順序帶成下一個可用號
  if (!milestone && nextSeq !== null && form.seq === "1" && nextSeq !== 1) {
    setForm((f) => (f.seq === "1" ? { ...f, seq: String(nextSeq) } : f));
  }

  // ★「綁定」到底綁到什麼——選了期別立刻把該期的批次算給他看，
  // 抽象的下拉就變成具體的「這一期有 4 批、76 噸」
  const units = useQuery({
    queryKey: ["tracking-units", { project: projectId, page_size: 200 }],
    queryFn: () =>
      api.get<{
        results: Array<{
          id: number;
          name: string;
          phase: number | null;
          total_weight_kg: string | null;
        }>;
      }>("/tracking-units", { project: projectId!, page_size: 200 }),
    enabled: open && projectId !== null,
  });

  // 名稱預設：選了期別就用期別名稱，沒選就依順序推「第N期」。
  // 多數合約的請款條件就是照期別分的，讓人少打一次字
  const suggestedName = form.phase
    ? (detail.data?.phases.find((p) => String(p.id) === form.phase)?.name ?? "")
    : phaseName(Number(form.seq) || 1);

  if (!milestone && !nameTouched && suggestedName && form.label !== suggestedName) {
    setForm((f) => (f.label === suggestedName ? f : { ...f, label: suggestedName }));
  }

  const locations = useQuery({
    queryKey: ["locations", "site"],
    queryFn: () =>
      api.get<Array<{ id: number; name: string; full_path: string }>>("/locations", {
        type: "site,warehouse",
      }),
    enabled: open,
    staleTime: 10 * 60 * 1000,
  });

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      milestone
        ? api.patch<Milestone>(`/billing-milestones/${milestone.id}`, body)
        : api.post<Milestone>("/billing-milestones", body),
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ["billing"] });
      qc.invalidateQueries({ queryKey: ["project"] });
      toast.success(
        milestone ? `${saved.label} 已更新` : `已建立「${saved.label}」`,
        [`金額 ${Number(saved.amount).toLocaleString("zh-TW")} 元（合約額 × ${saved.percentage}%）`],
      );
      close();
    },
  });

  const error = save.error instanceof ApiError ? save.error : null;
  const help = TRIGGER_HELP[form.trigger_type];
  const effective = detail.data?.effective_amount ? Number(detail.data.effective_amount) : null;
  const preview =
    effective !== null && form.percentage
      ? (effective * Number(form.percentage)) / 100
      : null;

  function close() {
    save.reset();
    onClose();
  }

  function submit() {
    save.mutate({
      project: Number(form.project),
      phase: form.phase ? Number(form.phase) : null,
      seq: Number(form.seq),
      label: form.label.trim(),
      trigger_desc: form.trigger_desc,
      percentage: form.percentage,
      trigger_type: form.trigger_type,
      threshold_pct: form.trigger_type === "weight_threshold" ? form.threshold_pct : null,
      target_location: form.target_location ? Number(form.target_location) : null,
      note: form.note,
    });
  }

  const set = (k: keyof FormState) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const complete = form.project && form.label.trim() && form.percentage;

  // 這筆里程碑實際會看哪些批次
  const scoped = (units.data?.results ?? []).filter(
    (u) => !form.phase || String(u.phase) === form.phase,
  );
  const scopedWeight = scoped.reduce((s, u) => s + Number(u.total_weight_kg ?? 0), 0);
  const missingWeight = scoped.filter((u) => !u.total_weight_kg);
  const needsWeight =
    form.trigger_type === "per_batch" || form.trigger_type === "weight_threshold";

  // 比例加總，避免建到一半才發現超過 100%
  const otherPct = (siblings.data?.results ?? [])
    .filter((m) => !milestone || m.seq !== milestone.seq)
    .reduce((s, m) => s + Number((m as { percentage?: string }).percentage ?? 0), 0);
  const totalPct = otherPct + Number(form.percentage || 0);

  return (
    <Modal open={open} onClose={close} title={milestone ? "修改請款里程碑" : "新增請款里程碑"}>
      {!milestone && (
        <Field label="專案" required error={error?.fieldError("project")}>
          <Select
            value={form.project}
            onChange={set("project")}
            options={(options?.projects ?? []).map((p) => ({ value: p.id, label: p.name }))}
            placeholder="請選擇"
            className="w-full"
          />
        </Field>
      )}

      <div className="grid grid-cols-[80px_1fr] gap-3">
        <Field label="順序" required error={error?.fieldError("seq")}>
          <input
            type="number"
            min={1}
            value={form.seq}
            onChange={(e) => set("seq")(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="名稱" required error={error?.fieldError("label")}>
          <input
            value={form.label}
            onChange={(e) => {
              setNameTouched(true);
              set("label")(e.target.value);
            }}
            placeholder="如「第一期請款」"
            className={inputClass}
          />
        </Field>
      </div>

      <Field
        label="合約原文"
        hint="把合約上那一句抄進來。日後對帳時不用再翻合約"
      >
        <textarea
          rows={2}
          value={form.trigger_desc}
          onChange={(e) => set("trigger_desc")(e.target.value)}
          placeholder="如「第一期構件全數運抵工地並經業主簽收後請款」"
          className={inputClass}
        />
      </Field>

      <Field
        label="比例 (%)"
        required
        hint={
          preview !== null
            ? `金額由系統算：有效合約額 ${effective!.toLocaleString("zh-TW")} × ${form.percentage}% = ${preview.toLocaleString("zh-TW", { maximumFractionDigits: 0 })} 元` +
              (form.percentage
                ? `　｜　含這筆全案共 ${totalPct.toFixed(0)}%${
                    totalPct > 100 ? "（超過 100%）" : totalPct < 100 ? `，還差 ${(100 - totalPct).toFixed(0)}%` : " ✔"
                  }`
                : "")
            : "金額＝有效合約額 × 比例，由系統算，不手填"
        }
        error={error?.fieldError("percentage")}
      >
        <input
          type="number"
          inputMode="decimal"
          min={0}
          max={100}
          value={form.percentage}
          onChange={(e) => set("percentage")(e.target.value)}
          className={inputClass}
        />
      </Field>

      <Field label="觸發方式" required>
        <Select
          value={form.trigger_type}
          onChange={set("trigger_type")}
          options={options?.trigger_type ?? []}
          className="w-full"
        />
      </Field>
      {help && (
        <div className="-mt-1 mb-3 rounded-lg bg-page px-3 py-2 text-[11px] leading-relaxed">
          <p className="font-semibold text-ink-2">{help.desc}</p>
          <p className="mt-0.5 text-ink-3">{help.example}</p>
        </div>
      )}

      {form.trigger_type === "weight_threshold" && (
        <Field
          label="門檻 (%)"
          required
          hint="累計簽收噸數佔該期總噸數的比例達到這個數字就觸發"
          error={error?.fieldError("threshold_pct")}
        >
          <input
            type="number"
            inputMode="decimal"
            min={1}
            max={100}
            value={form.threshold_pct}
            onChange={(e) => set("threshold_pct")(e.target.value)}
            placeholder="80"
            className={inputClass}
          />
        </Field>
      )}

      {(form.trigger_type === "per_batch" || form.trigger_type === "weight_threshold") && (
        <p
          className="mb-3 rounded-lg px-3 py-2 text-[11px] leading-relaxed"
          style={{ background: "var(--color-atrisk-bg)", color: "var(--color-atrisk)" }}
        >
          這兩種觸發方式要靠<strong>批次的總重量</strong>算佔比。
          該期的批次沒填重量就算不出來，系統會提示但不會擋住簽收。
        </p>
      )}

      {projectId !== null && (
        <>
          <Field
            label="適用期別"
            hint="★ 這就是「綁定」。批次不是直接綁到里程碑，是兩邊都綁期別，靠期別對上"
          >
            {detail.data?.phases?.length ? (
              <Select
                value={form.phase}
                onChange={set("phase")}
                options={detail.data.phases.map((p) => ({ value: p.id, label: p.name }))}
                placeholder="全案（看所有批次）"
                className="w-full"
              />
            ) : (
              <p className="rounded-lg bg-page px-3 py-2 text-[11px] leading-relaxed text-ink-2">
                這個案子還沒分期，這筆里程碑會<strong>看全案所有批次</strong>。
                若合約是分期請款，先到<strong>專案頁展開該案 → 期別</strong>建立，再回來綁。
              </p>
            )}
          </Field>

          {/* 綁定的結果立刻可見——不用等到簽收才發現綁錯 */}
          <div className="-mt-1 mb-3 rounded-lg bg-page px-3 py-2 text-[11px] leading-relaxed">
            <p className="font-semibold text-ink">
              這筆會看 {scoped.length} 個追蹤單元
              {form.phase
                ? `（僅 ${detail.data?.phases.find((p) => String(p.id) === form.phase)?.name}）`
                : "（全案）"}
              {scopedWeight > 0 && `，合計 ${(scopedWeight / 1000).toFixed(1)} 噸`}
            </p>
            {scoped.length > 0 && (
              <p className="mt-0.5 text-ink-2">
                {scoped.slice(0, 5).map((u) => u.name).join("、")}
                {scoped.length > 5 && ` …等 ${scoped.length} 個`}
              </p>
            )}
            {scoped.length === 0 && (
              <p className="mt-0.5 text-ink-3">
                這個範圍還沒有追蹤單元。沒有批次就不會有簽收，也就不會觸發請款。
              </p>
            )}
            {needsWeight && missingWeight.length > 0 && (
              <p className="mt-1 font-semibold" style={{ color: "var(--color-delayed)" }}>
                其中 {missingWeight.length} 個沒填總重量 —— 這種觸發方式算不出佔比
              </p>
            )}
          </div>
        </>
      )}

      <Field label="合約指定交貨地點" hint="簽收地點跟這裡不符時會警告，但不會擋住簽收">
        <Select
          value={form.target_location}
          onChange={set("target_location")}
          options={(locations.data ?? []).map((l) => ({ value: l.id, label: l.full_path }))}
          placeholder="不指定"
          className="w-full"
        />
      </Field>

      <Field label="備註">
        <input value={form.note} onChange={(e) => set("note")(e.target.value)} className={inputClass} />
      </Field>

      {milestone && milestone.claims.length > 0 && (
        <p
          className="mb-3 rounded-lg px-3 py-2 text-[11px] leading-relaxed"
          style={{ background: "var(--color-atrisk-bg)", color: "var(--color-atrisk)" }}
        >
          這一筆已經產生 {milestone.claims.length} 筆請款事件，<strong>金額不會重算</strong>——
          已經送出去的數字不能被改掉。
        </p>
      )}

      <FormErrors
        error={error}
        handled={["project", "label", "percentage", "threshold_pct", "seq"]}
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
          {milestone ? "儲存" : "建立"}
        </Button>
      </div>
    </Modal>
  );
}
