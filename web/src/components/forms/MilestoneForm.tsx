/**
 * 應收款（單期）表單
 *
 * 只在兩個地方出現：金流→應收 的「新增一期」，與專案明細的分期編輯。
 * 建案時的整批分期在 ProjectForm 裡一次填，不經過這裡。
 *
 * 金額不讓人填——金額＝有效合約額 × 比例，由系統算。
 * 讓人直接填金額，比例跟金額遲早對不上。
 */
import { useState } from "react";

import { ApiError } from "@/api/client";
import { useDeleteMilestone, useOptions, useSaveMilestone } from "@/api/hooks";
import type { Milestone } from "@/api/types";
import { Button, Field, FormErrors, Modal, inputClass } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";

export default function MilestoneForm({
  milestone,
  projectId,
  onClose,
}: {
  milestone: Milestone | null;
  /** 從專案明細開啟時鎖定專案，不再顯示專案下拉 */
  projectId?: number;
  onClose: () => void;
}) {
  const { data: options } = useOptions();
  const save = useSaveMilestone();
  const remove = useDeleteMilestone();
  const toast = useToast();
  const [error, setError] = useState<ApiError | null>(null);

  const [project, setProject] = useState(
    milestone?.project ?? projectId ?? options?.projects[0]?.id ?? 0,
  );
  const [label, setLabel] = useState(milestone?.label ?? "");
  const [percentage, setPercentage] = useState(milestone?.percentage ?? "");
  const [condition, setCondition] = useState(milestone?.condition ?? "");
  const [expectedDate, setExpectedDate] = useState(milestone?.expected_date ?? "");
  const [note, setNote] = useState(milestone?.note ?? "");

  const locked = milestone !== null && (milestone.state === "invoiced" || milestone.state === "received");

  function submit() {
    setError(null);
    save.mutate(
      {
        id: milestone?.id,
        ...(milestone ? {} : { project }),
        label,
        percentage,
        condition,
        expected_date: expectedDate || null,
        note,
      },
      {
        onSuccess: () => {
          toast.success(milestone ? "已更新" : "已新增一期");
          onClose();
        },
        onError: (e) => {
          if (e instanceof ApiError) setError(e);
          else toast.error("儲存失敗");
        },
      },
    );
  }

  function submitDelete() {
    if (!milestone) return;
    if (!window.confirm(`確定刪除「${milestone.label}」？`)) return;
    remove.mutate(milestone.id, {
      onSuccess: () => {
        toast.success("已刪除");
        onClose();
      },
      onError: () => toast.error("刪除失敗——已請款的列不能刪"),
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={milestone ? `編輯：${milestone.label}` : "新增一期應收款"}
      footer={
        <>
          {milestone && !locked && (
            <Button variant="danger" onClick={submitDelete} loading={remove.isPending}>
              刪除
            </Button>
          )}
          <Button className="flex-1" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            loading={save.isPending}
            disabled={!label.trim() || !percentage}
            onClick={submit}
          >
            儲存
          </Button>
        </>
      }
    >
      <FormErrors error={error} handled={["label", "percentage", "seq", "project"]} />

      {locked && (
        <p className="mb-3 rounded-lg bg-page px-3 py-2 text-[11px] text-ink-2">
          這一期已經請款，比例與金額不會重算——送出去的數字不能被系統改掉。
        </p>
      )}

      {!milestone && projectId === undefined && (
        <Field label="專案" required>
          <select
            value={project}
            onChange={(e) => setProject(Number(e.target.value))}
            className={inputClass}
          >
            {(options?.projects ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label="名稱" required>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className={inputClass}
          placeholder="如「第二期（出貨）」"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="比例(%)" required hint="金額＝合約額×比例，自動算">
          <input
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={percentage}
            onChange={(e) => setPercentage(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="預計請款日" hint="現金流預估靠它，之後可改">
          <input
            type="date"
            value={expectedDate}
            onChange={(e) => setExpectedDate(e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="合約條件" hint="合約原文，提醒自己什麼條件到了可以請">
        <input
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
          className={inputClass}
          placeholder="如「構件全數運抵工地並經業主簽收」"
        />
      </Field>

      <Field label="備註">
        <input value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} />
      </Field>
    </Modal>
  );
}
