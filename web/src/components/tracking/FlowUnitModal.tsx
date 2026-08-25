/**
 * 流程單元明細（排程表、看板、我的任務共用同一個入口——一件事一個入口）
 *
 * 回答的問題：這一步要做什麼、誰在做、排到什麼時候、做到哪了。
 * 2026-08-17 改版：點開直接顯示全部內容，**不摺疊**——
 * 有排程編輯權的人打開就是可以改的表單，不用先按「編輯排程」。
 *
 * 操作依權限出現：
 *   負責人本人　　　開始／完成／回報進度／維護工作項目
 *   進度維護權限　　＋直接改排程（負責人、日期、數量）
 */
import { CheckCircle2, Play, Plus, RotateCcw, Wallet, X } from "lucide-react";
import { useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { ApiError, api } from "@/api/client";
import {
  useAddFlowTask,
  useAddTaskAssignment,
  useDeleteFlowTask,
  useDeleteTaskAssignment,
  useFlowTransition,
  useFlowUnit,
  useMilestones,
  useOptions,
  useSaveFlowTask,
  usePayables,
  useSaveFlowUnit,
  useSaveMilestone,
  useSavePayable,
  useSaveTaskAssignment,
} from "@/api/hooks";
import { useCurrentUser } from "@/api/hooks/useAuth";
import type { FlowTask, FlowTaskAssignment, FlowUnit } from "@/api/types";
import AttachmentSection from "@/components/attachments/AttachmentSection";
import FlowStateBadge from "@/components/tracking/FlowStateBadge";
import { Button, DateInput, Field, inputClass, Modal } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";

export default function FlowUnitModal({
  unitId,
  onClose,
}: {
  unitId: number | null;
  onClose: () => void;
}) {
  const { data: unit } = useFlowUnit(unitId);
  if (unitId === null) return null;
  return (
    // 從右側滑出（約 1/3 螢幕，D47）——排程表、甘特圖留在左邊，兩邊對照著看
    <Modal open side onClose={onClose} title={unit ? `${unit.flow_code} ${unit.flow_name}` : "載入中…"}>
      {unit && <Body unit={unit} onClose={onClose} />}
    </Modal>
  );
}

function Body({ unit, onClose }: { unit: FlowUnit; onClose: () => void }) {
  const { data: user } = useCurrentUser();
  const toast = useToast();
  const transition = useFlowTransition();
  const [addingPayable, setAddingPayable] = useState(false);

  const canEditSchedule = Boolean(user?.permissions.edit_tracking);
  const canAddPayable = Boolean(user?.permissions.edit_payable);
  const canLinkBilling = Boolean(
    user?.permissions.view_money && user?.permissions.edit_milestone,
  );
  const open = unit.state === "todo" || unit.state === "doing";

  function move(toState: string, note = "") {
    transition.mutate(
      { id: unit.id, to_state: toState, note },
      {
        onSuccess: (saved) =>
          toast.success(`${saved.flow_name} → ${saved.state_label}`),
        onError: (e) =>
          toast.error(e instanceof ApiError ? e.body.detail ?? "操作失敗" : "操作失敗"),
      },
    );
  }

  function reopen() {
    const note = window.prompt("重啟已完成的流程必須說明原因：");
    if (note) move("doing", note);
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <FlowStateBadge state={unit.state} overdue={unit.is_overdue} />
        <span className="text-xs text-ink-2">{unit.project_name}</span>
        <span className="text-[11px] text-ink-3">
          第{unit.stage_seq}階段 · {unit.stage_name}
        </span>
      </div>

      {/* ★ 全卡片唯一的文字區塊（D43）：工作內容＋產出物＋完成條件都在這一格。
          「詳細內容」欄位已併入工作內容——兩個都在回答「這一步要做什麼」，
          分兩格只會看起來像同一個區塊被複製 */}
      <SpecBlock key={unit.id} unit={unit} canEdit={canEditSchedule} />

      <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        {!canEditSchedule && (
          <InfoRow label="負責人" value={unit.assignee_name || "未指派"} warn={!unit.assignee_name && unit.state === "doing"} />
        )}
        {unit.subcontractor_name && <InfoRow label="協力廠商" value={unit.subcontractor_name} />}
        {!canEditSchedule && (
          <InfoRow
            label="預計"
            value={unit.plan_start || unit.plan_end ? `${unit.plan_start ?? "？"} ~ ${unit.plan_end ?? "？"}` : "未排"}
            warn={unit.is_overdue}
          />
        )}
        {(unit.actual_start || unit.actual_end) && (
          <InfoRow label="實際" value={`${unit.actual_start ?? "？"} ~ ${unit.actual_end ?? "－"}`} />
        )}
      </dl>

      <Progress unit={unit} />

      {/* 排程緊跟在進度下面（D45），且不再有總數量／單位——進度由分配算 */}
      {canEditSchedule && <ScheduleEditor key={unit.id} unit={unit} />}

      <TaskSection unit={unit} />

      {/* 操作列 */}
      {(unit.can_operate || canAddPayable) && (
        <div className="mb-3 flex flex-wrap gap-2">
          {unit.can_operate && unit.state === "todo" && (
            <Button variant="primary" onClick={() => move("doing")} loading={transition.isPending}>
              <Play size={14} />
              開始
            </Button>
          )}
          {unit.can_operate && open && (
            <Button
              variant={unit.state === "doing" ? "primary" : "secondary"}
              onClick={() => move("done")}
              loading={transition.isPending}
            >
              <CheckCircle2 size={14} />
              完成
            </Button>
          )}
          {unit.can_operate && unit.state === "done" && (
            <Button onClick={reopen} loading={transition.isPending}>
              <RotateCcw size={14} />
              重啟（需原因）
            </Button>
          )}
          {canAddPayable && (
            <Button onClick={() => setAddingPayable((v) => !v)}>
              <Wallet size={14} />
              新增應付帳款
            </Button>
          )}
        </div>
      )}
      {canAddPayable && addingPayable && (
        <AddPayableForm unit={unit} onDone={() => setAddingPayable(false)} />
      )}

      {/* 收款連結（D45）：這一步完成 → 哪一期應收自動轉可請款、由哪位會計師負責 */}
      {canLinkBilling && <BillingLinkSection unit={unit} />}

      {/* 掛在這一步的應付款（D47）——在卡片上就看得到這一步花了什麼錢 */}
      {user?.permissions.view_money && <UnitPayables unit={unit} />}
      {unit.state === "done" && unit.is_gate && (
        <p className="mb-3 rounded-lg px-3 py-2 text-[11px]" style={{ background: "var(--color-ontrack-bg)", color: "var(--color-ontrack)" }}>
          這是關卡流程——完成代表可以進入下一階段。
        </p>
      )}

      <AttachmentSection target="flow-unit" id={unit.id} title="檔案（產出物、現場照片）" defaultCategory="other" compact />

      <div className="mt-3 flex">
        <Button onClick={onClose} className="flex-1">
          關閉
        </Button>
      </div>
    </div>
  );
}

function SpecRow({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <dt className="font-semibold text-ink-2">{label}</dt>
      <dd className="whitespace-pre-line text-ink-2">{text}</dd>
    </div>
  );
}

const SPEC_FIELDS = [
  { key: "description", label: "工作內容" },
  { key: "deliverables", label: "產出物" },
  { key: "done_criteria", label: "完成條件" },
] as const;

/**
 * 工作內容區塊——**整張卡片唯一的一格**（D43），三個欄位都在裡面。
 * D44：三個都可編輯，但輸入框固定兩行高、擠在同一格——不會再看起來像
 * 好幾個重複的區塊。自動儲存走行內「已儲存 ✓」，不彈出提示卡片。
 */
function SpecBlock({ unit, canEdit }: { unit: FlowUnit; canEdit: boolean }) {
  const save = useSaveFlowUnit();
  const toast = useToast();
  const [form, setForm] = useState({
    description: unit.description,
    deliverables: unit.deliverables,
    done_criteria: unit.done_criteria,
  });
  const [saved, setSaved] = useState(false);

  function commit(key: (typeof SPEC_FIELDS)[number]["key"]) {
    if (form[key] === unit[key]) return;
    save.mutate(
      { id: unit.id, [key]: form[key] },
      {
        onSuccess: () => {
          setSaved(true);
          window.setTimeout(() => setSaved(false), 2500);
        },
        onError: (e) =>
          toast.error(e instanceof ApiError ? e.body.detail ?? "更新失敗" : "更新失敗"),
      },
    );
  }

  if (!canEdit && !unit.description && !unit.deliverables && !unit.done_criteria) return null;

  return (
    <div className="mb-3 rounded-lg bg-page px-3 py-2.5">
      {canEdit ? (
        <>
          {SPEC_FIELDS.map((f, i) => (
            <label key={f.key} className={`block ${i > 0 ? "mt-1.5" : ""}`}>
              <span className="text-[11px] font-semibold text-ink-2">
                {f.label}
                {i === 0 && saved && (
                  <span className="ml-1.5 font-normal text-ink-3">已儲存 ✓</span>
                )}
              </span>
              <textarea
                rows={2}
                value={form[f.key]}
                onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                onBlur={() => commit(f.key)}
                className={`${inputClass} mb-0 mt-0.5 text-[11px] leading-relaxed`}
              />
            </label>
          ))}
          <p className="mt-1.5 text-[10px] leading-relaxed text-ink-3">
            改完離開欄位就會儲存，只影響這個案子；新案的預設內容在後台的流程目錄維護。
          </p>
        </>
      ) : (
        <dl className="space-y-1.5 text-[11px] leading-relaxed">
          {unit.description && <SpecRow label="工作內容" text={unit.description} />}
          {unit.deliverables && <SpecRow label="產出物" text={unit.deliverables} />}
          {unit.done_criteria && <SpecRow label="完成條件" text={unit.done_criteria} />}
        </dl>
      )}
    </div>
  );
}

function InfoRow({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] text-ink-3">{label}</dt>
      <dd
        className="font-semibold"
        style={{ color: warn ? "var(--color-delayed)" : "var(--color-ink)" }}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * 進度區——**只顯示，不手動回報**（D44）。
 *   批次彙總單元　數字由批次過站回寫
 *   其餘單元　　　＝各工作項目總進度的平均（項目進度由工段分配算出來）
 * 要改進度就去回報工作分配的完成量，不是在這裡填數字。
 */
function Progress({ unit }: { unit: FlowUnit }) {
  if (unit.state === "na") return null;
  const isBatchQty = unit.is_batch_driven && unit.qty_total !== null;

  return (
    <div className="mb-3 rounded-lg bg-page px-3 py-2.5">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-semibold text-ink-2">進度</span>
        <span className="font-bold tabular-nums text-ink">
          {isBatchQty && (
            <span className="mr-1.5">
              {Number(unit.qty_done)} / {Number(unit.qty_total)} {unit.unit_of_measure}
            </span>
          )}
          {unit.completion_ratio}%
        </span>
      </div>
      <div className="mt-1.5 h-1.5 rounded-full bg-line">
        <div
          className="h-full rounded-full"
          style={{ width: `${unit.completion_ratio}%`, background: "var(--color-stage-2)" }}
        />
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-3">
        {unit.is_batch_driven ? (
          <>
            這一步的進度由<strong>構件批次自動彙總</strong>——到專案明細的「構件批次」
            區塊推進批次，這裡的數字就會跟著動。
          </>
        ) : unit.tasks.length > 0 ? (
          "進度由下面的工作分配自動計算（各項目總進度的平均），員工回報完成量就會更新。"
        ) : (
          "進度不手動填——新增工作項目、把工段分配給員工，回報後這裡會自動計算。"
        )}
      </p>
    </div>
  );
}

/** 狀態選項的頭尾——不是可分配的工段 */
const TERMINAL = ["未開始", "已完成"];

/**
 * 工作項目：這一步的內容物清單。
 * 「採購」不會只買一種東西——一列＝一個內容物（如「鐵材 200 噸」）。
 * D45：狀態清單是**每個項目自己的**（鐵材走切割→噴漆、螺栓走下訂→到貨），
 * 由使用者自己新增，可沿用之前用過的字；每個狀態＝一個可分配的工段。
 */
function TaskSection({ unit }: { unit: FlowUnit }) {
  const { data: user } = useCurrentUser();
  const { data: options } = useOptions();
  const addTask = useAddFlowTask();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", qty: "", unit_of_measure: "" });

  const canEdit = unit.can_operate && unit.state !== "na";
  if (unit.tasks.length === 0 && !canEdit) return null;

  // 沿用先前新增過的狀態：全系統常用字＋這張單元其他項目在用的字
  const suggestions = [
    ...new Set([
      ...(options?.task_status_suggestions ?? []),
      ...unit.tasks.flatMap((t) => t.statuses),
    ]),
  ];

  function submitDraft() {
    if (!draft.name.trim()) return;
    addTask.mutate(
      {
        unit: unit.id,
        name: draft.name.trim(),
        qty: draft.qty || null,
        unit_of_measure: draft.unit_of_measure,
      },
      {
        onSuccess: () => {
          setDraft({ name: "", qty: "", unit_of_measure: "" });
          setAdding(false);
          toast.success("工作項目已新增");
        },
        onError: (e) =>
          toast.error(e instanceof ApiError ? e.body.detail ?? "新增失敗" : "新增失敗"),
      },
    );
  }

  return (
    <div className="mb-3 rounded-lg bg-page px-3 py-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-ink-2">
          工作項目
          {unit.tasks.length > 0 && (
            <span className="ml-1.5 font-normal text-ink-3">{unit.tasks.length} 項</span>
          )}
        </span>
        {canEdit && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold text-ink-2 transition-base hover:bg-card"
          >
            <Plus size={12} />
            新增項目
          </button>
        )}
      </div>

      {unit.tasks.length === 0 && !adding && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-3">
          這一步要處理哪些東西？例如「鐵材 200 噸」——點「新增項目」開始記。
          每個項目有**自己的**狀態清單（鐵材走切割→噴漆、螺栓走下訂→到貨），
          加好後能把每個工段的數量分配給員工做。
        </p>
      )}

      {unit.tasks.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {unit.tasks.map((task) => (
            <TaskRow key={task.id} task={task} canEdit={canEdit} userId={user?.id ?? null} />
          ))}
        </ul>
      )}

      {/* 狀態輸入框的建議清單（沿用先前新增過的字），所有項目共用這一份 datalist */}
      <datalist id="task-status-suggestions">
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      {adding && (
        <div className="mt-2 rounded-lg bg-card p-2 ring-1 ring-line">
          {/* 內容物是主角，自己佔一整行——跟數量單位擠一排會被壓扁 */}
          <input
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder="內容物（如：鐵材）"
            autoFocus
            className={`${inputClass} mb-0`}
          />
          <div className="mt-1.5 flex gap-1.5">
            <input
              type="number"
              inputMode="decimal"
              value={draft.qty}
              onChange={(e) => setDraft((d) => ({ ...d, qty: e.target.value }))}
              placeholder="數量"
              className={`${inputClass} mb-0 w-24 text-right`}
            />
            <input
              value={draft.unit_of_measure}
              onChange={(e) => setDraft((d) => ({ ...d, unit_of_measure: e.target.value }))}
              placeholder="單位"
              className={`${inputClass} mb-0 w-20`}
            />
            <span className="flex items-center text-[11px] text-ink-3">狀態預設「未開始」</span>
          </div>
          <div className="mt-1.5 flex gap-1.5">
            <Button onClick={() => setAdding(false)} className="flex-1">
              取消
            </Button>
            <Button
              variant="primary"
              onClick={submitDraft}
              loading={addTask.isPending}
              disabled={!draft.name.trim()}
              className="flex-1"
            >
              新增
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 單一工作項目的狀態清單維護（D45）：晶片＝目前的工段，
 * 輸入＋「新增」加一個（輸入框帶建議——沿用之前新增過的字）。
 * 每個狀態＝一個可分配的工段；「未開始／已完成」是隱含頭尾，不用加。
 */
function TaskStatusEditor({ task }: { task: FlowTask }) {
  const saveTask = useSaveFlowTask();
  const toast = useToast();
  const [draft, setDraft] = useState("");

  function commit(list: string[], okMessage: string) {
    saveTask.mutate(
      { id: task.id, statuses: list },
      {
        onSuccess: () => toast.success(okMessage),
        onError: (e) =>
          toast.error(e instanceof ApiError ? e.body.detail ?? "更新失敗" : "更新失敗"),
      },
    );
  }

  function add() {
    const name = draft.trim();
    setDraft("");
    if (!name || task.statuses.includes(name) || TERMINAL.includes(name)) return;
    commit([...task.statuses, name], `${task.name}：已新增狀態「${name}」`);
  }

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      <span className="text-[11px] text-ink-3">工段</span>
      {task.statuses.map((s) => (
        <span
          key={s}
          className="flex items-center gap-0.5 rounded-full bg-page px-2 py-0.5 text-[11px] font-semibold text-ink-2"
        >
          {s}
          <button
            type="button"
            onClick={() => commit(task.statuses.filter((x) => x !== s), `已移除「${s}」`)}
            aria-label={`移除狀態 ${s}`}
            className="rounded p-px text-ink-3 transition-base hover:text-[var(--color-delayed)]"
          >
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        list="task-status-suggestions"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") add();
        }}
        placeholder="新狀態（如：切割中）"
        aria-label={`${task.name} 的新狀態`}
        className="w-32 rounded-md border border-line bg-page px-1.5 py-0.5 text-[11px] text-ink"
      />
      <button
        type="button"
        onClick={add}
        disabled={!draft.trim()}
        className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-ink-2 ring-1 ring-line transition-base hover:bg-page disabled:opacity-40"
      >
        新增
      </button>
    </div>
  );
}

/** 單列工作項目：名稱與總進度、狀態（下拉）、自己的工段清單與分配 */
function TaskRow({
  task,
  canEdit,
  userId,
}: {
  task: FlowTask;
  canEdit: boolean;
  userId: number | null;
}) {
  const saveTask = useSaveFlowTask();
  const deleteTask = useDeleteFlowTask();
  const toast = useToast();

  const qtyText =
    task.qty !== null && Number(task.qty) > 0
      ? `${Number(task.qty)} ${task.unit_of_measure}`.trim()
      : "";
  const workStatuses = task.statuses.filter((s) => !TERMINAL.includes(s));
  // 下拉＝隱含頭尾＋這個項目自己的工段；舊值不在清單裡就補進去，不然會憑空消失
  const dropdown = ["未開始", ...workStatuses, "已完成"];
  const options = dropdown.includes(task.status) ? dropdown : [task.status, ...dropdown];

  function changeStatus(next: string) {
    if (next === task.status) return;
    saveTask.mutate(
      { id: task.id, status: next },
      {
        onSuccess: () => toast.success(`${task.name} → ${next}`),
        onError: (e) =>
          toast.error(e instanceof ApiError ? e.body.detail ?? "更新失敗" : "更新失敗"),
      },
    );
  }

  function remove() {
    if (!window.confirm(`刪除「${task.name}」？（工作分配會一併刪除）`)) return;
    deleteTask.mutate(task.id, {
      onError: (e) =>
        toast.error(e instanceof ApiError ? e.body.detail ?? "刪除失敗" : "刪除失敗"),
    });
  }

  return (
    <li className="rounded-lg bg-card px-2.5 py-2 text-xs ring-1 ring-line">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-semibold text-ink">
          {task.name}
          {qtyText && <span className="ml-1.5 font-normal tabular-nums text-ink-2">{qtyText}</span>}
        </span>
        {workStatuses.length > 0 && (
          <span className="shrink-0 text-[11px] font-bold tabular-nums text-ink">
            總進度 {task.progress_pct}%
          </span>
        )}
        {canEdit && (
          <button
            type="button"
            onClick={remove}
            aria-label={`刪除 ${task.name}`}
            className="shrink-0 rounded p-0.5 text-ink-3 transition-base hover:text-[var(--color-delayed)]"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* 狀態自己一行（D41）：從單元的狀態選項挑 */}
      <div className="mt-1.5 flex items-center gap-2">
        <span className="shrink-0 text-[11px] text-ink-3">狀態</span>
        {canEdit ? (
          <select
            value={task.status}
            onChange={(e) => changeStatus(e.target.value)}
            aria-label={`${task.name} 的狀態`}
            className="rounded-md border border-line bg-page px-1.5 py-1 text-[11px] font-semibold text-ink"
          >
            {options.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        ) : (
          <span className="rounded-full bg-page px-2 py-0.5 text-[11px] font-semibold text-ink-2">
            {task.status}
          </span>
        )}
      </div>

      {/* 這個項目自己的工段清單（使用者自己加，可沿用之前的字） */}
      {canEdit && <TaskStatusEditor task={task} />}

      {/* 各工段：彙總進度＋分配清單。工段完成度平均起來＝上面的總進度 */}
      {workStatuses.length > 0 && (canEdit || task.assignments.length > 0) && (
        <div className="mt-1.5 space-y-1">
          {workStatuses.map((ws) => (
            <StageBlock key={ws} task={task} status={ws} canEdit={canEdit} userId={userId} />
          ))}
        </div>
      )}
    </li>
  );
}

/** 一個工段：彙總進度條＋每個員工的分配（可回報）＋「分配」表單 */
function StageBlock({
  task,
  status,
  canEdit,
  userId,
}: {
  task: FlowTask;
  status: string;
  canEdit: boolean;
  userId: number | null;
}) {
  const [assigning, setAssigning] = useState(false);
  const rows = task.assignments.filter((a) => a.status === status);
  const done = rows.reduce((sum, a) => sum + Number(a.qty_done), 0);
  const assigned = rows.reduce((sum, a) => sum + Number(a.qty_assigned), 0);
  const denom = Number(task.qty) || assigned;
  const pct = denom ? Math.min(Math.round((done / denom) * 1000) / 10, 100) : 0;
  // 還沒分出去的量——提醒管理者這個工段還有多少沒人做（D44）
  const remain = task.qty !== null ? Number(task.qty) - assigned : null;

  return (
    <div className="rounded-md bg-page px-2 py-1.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-ink-2">{status}</span>
        {canEdit && remain !== null && remain > 0 && (
          <span
            className="shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold"
            style={{ background: "var(--color-atrisk-bg, var(--color-page))", color: "var(--color-atrisk)" }}
          >
            還可分 {remain}
            {task.unit_of_measure && ` ${task.unit_of_measure}`}
          </span>
        )}
        <span className="shrink-0 text-[11px] tabular-nums text-ink">
          {done}/{denom || "？"}
          {task.unit_of_measure && ` ${task.unit_of_measure}`}
          <span className="ml-1 text-ink-3">({pct}%)</span>
        </span>
        {canEdit && (
          <button
            type="button"
            onClick={() => setAssigning((v) => !v)}
            className="flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[11px] font-semibold text-ink-2 transition-base hover:bg-card"
          >
            <Plus size={11} />
            分配
          </button>
        )}
      </div>
      <div className="mt-1 h-1 rounded-full bg-line">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: "var(--color-stage-2)" }}
        />
      </div>

      {rows.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {rows.map((a) => (
            <AssignmentRow key={a.id} assignment={a} canEdit={canEdit} userId={userId} uom={task.unit_of_measure} />
          ))}
        </ul>
      )}

      {assigning && <AssignForm task={task} status={status} onDone={() => setAssigning(false)} />}
    </div>
  );
}

/** 一份分配：員工＋完成量。被分到的本人（或經理）直接改數字回報 */
function AssignmentRow({
  assignment: a,
  canEdit,
  userId,
  uom,
}: {
  assignment: FlowTaskAssignment;
  canEdit: boolean;
  userId: number | null;
  uom: string;
}) {
  const save = useSaveTaskAssignment();
  const remove = useDeleteTaskAssignment();
  const toast = useToast();
  const [value, setValue] = useState(String(Number(a.qty_done)));
  const canReport = canEdit || a.assignee === userId;

  function commit() {
    if (value === "" || Number(value) === Number(a.qty_done)) {
      setValue(String(Number(a.qty_done)));
      return;
    }
    save.mutate(
      { id: a.id, qty_done: value },
      {
        onSuccess: (saved) => {
          setValue(String(Number(saved.qty_done)));
          toast.success(`${a.assignee_name}：${Number(saved.qty_done)}/${Number(saved.qty_assigned)}`);
        },
        onError: (e) => {
          setValue(String(Number(a.qty_done)));
          toast.error(e instanceof ApiError ? e.body.detail ?? "回報失敗" : "回報失敗");
        },
      },
    );
  }

  return (
    <li className="flex items-center gap-1.5 text-[11px]">
      <span className="min-w-0 flex-1 truncate text-ink-2">
        {a.assignee_name || "（已停用帳號）"}
        {a.is_done && <span className="ml-1 text-ink-3">✓</span>}
      </span>
      {canReport ? (
        <>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            max={Number(a.qty_assigned)}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            aria-label={`${a.assignee_name} 的完成量`}
            className="w-14 shrink-0 rounded border border-line bg-card px-1 py-0.5 text-right tabular-nums text-ink"
          />
          <span className="shrink-0 tabular-nums text-ink-3">
            /{Number(a.qty_assigned)}{uom && ` ${uom}`}
          </span>
        </>
      ) : (
        <span className="shrink-0 tabular-nums text-ink-3">
          {Number(a.qty_done)}/{Number(a.qty_assigned)}
          {uom && ` ${uom}`}
        </span>
      )}
      {canEdit && (
        <button
          type="button"
          onClick={() => {
            if (window.confirm(`取消分給 ${a.assignee_name} 的 ${Number(a.qty_assigned)}${uom}？`))
              remove.mutate(a.id, {
                onError: (e) =>
                  toast.error(e instanceof ApiError ? e.body.detail ?? "刪除失敗" : "刪除失敗"),
              });
          }}
          aria-label="取消這份分配"
          className="shrink-0 rounded p-0.5 text-ink-3 transition-base hover:text-[var(--color-delayed)]"
        >
          <X size={11} />
        </button>
      )}
    </li>
  );
}

/** 把總量以 0.01 為單位平均分成 n 份——前面每份取整、最後一份補差額，合計不多不少 */
function splitEvenly(total: number, n: number): string[] {
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / n);
  return Array.from({ length: n }, (_, i) =>
    ((i === n - 1 ? cents - base * (n - 1) : base) / 100).toFixed(2),
  );
}

/**
 * 分配表單（D42：可一次勾多個員工）。
 * 勾幾個人，填的總量就平均分成幾份，一人一份各自回報；
 * 每個人都會收到通知、出現在自己的「我的任務」。
 */
function AssignForm({
  task,
  status,
  onDone,
}: {
  task: FlowTask;
  status: string;
  onDone: () => void;
}) {
  const { data: options } = useOptions();
  const add = useAddTaskAssignment();
  const toast = useToast();
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [qty, setQty] = useState("");
  const [sending, setSending] = useState(false);

  // 這個工段還剩多少可以分（項目有填數量才有上限）
  const already = task.assignments
    .filter((a) => a.status === status)
    .reduce((sum, a) => sum + Number(a.qty_assigned), 0);
  const remain = task.qty !== null ? Number(task.qty) - already : null;

  const total = Number(qty);
  const shares =
    picked.size > 0 && total > 0 ? splitEvenly(total, picked.size) : [];
  const overRemain = remain !== null && total > remain;

  function toggle(id: number) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit() {
    if (picked.size === 0 || !(total > 0) || overRemain) return;
    const ids = [...picked];
    setSending(true);
    try {
      for (let i = 0; i < ids.length; i++) {
        await add.mutateAsync({
          task: task.id, status, assignee: ids[i], qty_assigned: shares[i],
        });
      }
      toast.success(
        ids.length === 1 ? "已分配" : `已平均分給 ${ids.length} 人`,
        ["每個人都會收到通知，並出現在自己的「我的任務」"],
      );
      onDone();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.body.detail ?? "分配失敗" : "分配失敗");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-1.5 rounded-md bg-card p-2 ring-1 ring-line">
      <p className="text-[11px] font-semibold text-ink-2">
        分配「{status}」——勾人，總量會平均分
      </p>
      <div className="mt-1 flex flex-wrap gap-1">
        {(options?.users ?? []).map((u) => {
          const on = picked.has(u.id);
          return (
            <button
              key={u.id}
              type="button"
              onClick={() => toggle(u.id)}
              aria-pressed={on}
              className={[
                "rounded-full px-2 py-0.5 text-[11px] font-semibold transition-base",
                on ? "bg-stage-2 text-white" : "bg-page text-ink-2",
              ].join(" ")}
            >
              {u.name}
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <input
          type="number"
          inputMode="decimal"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          placeholder={remain !== null ? `總量（最多 ${remain}）` : "總量"}
          aria-label="要分配的總量"
          className="w-24 shrink-0 rounded-md border border-line bg-page px-1.5 py-1 text-right text-[11px] tabular-nums text-ink"
        />
        {remain !== null && remain > 0 && (
          <button
            type="button"
            onClick={() => setQty(String(remain))}
            title={`把這個工段還沒分的 ${remain} 全部填入`}
            className="shrink-0 rounded-md px-1.5 py-1 text-[11px] font-semibold text-ink-2 ring-1 ring-line transition-base hover:bg-page"
          >
            最大
          </button>
        )}
        <span className="min-w-0 flex-1 truncate text-[10px] text-ink-3">
          {overRemain
            ? `超過剩餘量（還能分 ${remain}）`
            : picked.size > 1 && shares.length
              ? `每人約 ${shares[0]}${task.unit_of_measure ? ` ${task.unit_of_measure}` : ""}`
              : ""}
        </span>
        <Button
          onClick={submit}
          loading={sending}
          disabled={picked.size === 0 || !(total > 0) || overRemain}
        >
          分配{picked.size > 1 ? `（${picked.size} 人）` : ""}
        </Button>
      </div>
    </div>
  );
}

/**
 * 收款連結（D45）：把專案的應收期別掛在這個流程上——
 * 流程一完成，那期自動轉「可請款」，指定的會計師會收到通知、
 * 出現在他「我的任務」的待收款清單。
 */
function BillingLinkSection({ unit }: { unit: FlowUnit }) {
  const { data: options } = useOptions();
  const { data } = useMilestones({ project: unit.project, page_size: 100 });
  const save = useSaveMilestone();
  const toast = useToast();

  const milestones = data?.results ?? [];
  const linked = milestones.filter((m) => m.trigger_unit === unit.id);
  // 可以掛上來的：還沒掛觸發、也還沒走到請款的期別
  const linkable = milestones.filter((m) => m.trigger_unit === null && m.state === "pending");

  function patch(id: number, body: Record<string, unknown>, ok: string) {
    save.mutate(
      { id, ...body },
      {
        onSuccess: () => toast.success(ok),
        onError: (e) =>
          toast.error(e instanceof ApiError ? e.body.detail ?? "更新失敗" : "更新失敗"),
      },
    );
  }

  if (milestones.length === 0) return null;

  return (
    <div className="mb-3 rounded-lg bg-page px-3 py-2.5">
      <p className="text-xs font-semibold text-ink-2">收款連結</p>
      <p className="mt-0.5 text-[10px] leading-relaxed text-ink-3">
        掛上來的期別會在這一步完成時自動轉「可請款」，並通知指定的會計師收款
        （出現在他的「我的任務」）。
      </p>

      {linked.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {linked.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-1.5 rounded-md bg-card px-2 py-1.5 text-[11px] ring-1 ring-line">
              <span className="min-w-0 flex-1 truncate font-semibold text-ink">
                {m.label}
                <span className="ml-1.5 font-normal tabular-nums text-ink-2">
                  {Number(m.amount).toLocaleString("zh-TW")} 元
                </span>
              </span>
              <span className="shrink-0 rounded-full bg-page px-1.5 py-px font-semibold text-ink-2">
                {m.state_label}
              </span>
              <select
                value={m.accountant ?? ""}
                onChange={(e) =>
                  patch(m.id, { accountant: e.target.value ? Number(e.target.value) : null },
                        e.target.value ? "已指定收款會計師" : "已取消指定")
                }
                aria-label={`${m.label} 的收款會計師`}
                className="shrink-0 rounded-md border border-line bg-page px-1 py-0.5 text-[11px] text-ink"
              >
                <option value="">未指定會計師</option>
                {(options?.accountants ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() =>
                  patch(m.id, { trigger_unit: null },
                        "已取消連結——期別若在「可請款」會自動退回「未到」")
                }
                aria-label={`取消 ${m.label} 的連結`}
                className="shrink-0 rounded p-0.5 text-ink-3 transition-base hover:text-[var(--color-delayed)]"
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* D46：一步只掛一期——掛了就收起選單；別的流程掛走的期別也不會出現在這裡 */}
      {linked.length === 0 && linkable.length > 0 && (
        <select
          value=""
          onChange={(e) => {
            if (e.target.value)
              patch(Number(e.target.value), { trigger_unit: unit.id },
                    "已連結——這一步完成，那期就轉可請款");
          }}
          aria-label="把應收期別掛在這個流程上"
          className="mt-1.5 w-full rounded-md border border-line bg-card px-1.5 py-1 text-[11px] text-ink"
        >
          <option value="">＋把應收期別掛在這一步…</option>
          {linkable.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}（{Number(m.amount).toLocaleString("zh-TW")} 元）
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/**
 * 掛在這一步的應付款清單（D47）——從卡片登錄的、或在金流頁掛上這個流程的，
 * 全部列在這裡；點一筆跳去 金流 → 應付。
 */
function UnitPayables({ unit }: { unit: FlowUnit }) {
  const { data } = usePayables({ flow_unit: unit.id, page_size: 50 });
  const rows = data?.results ?? [];
  if (rows.length === 0) return null;

  return (
    <div className="mb-3 rounded-lg bg-page px-3 py-2.5">
      <p className="text-xs font-semibold text-ink-2">
        掛在這一步的應付款
        <span className="ml-1.5 font-normal text-ink-3">{rows.length} 筆</span>
      </p>
      <ul className="mt-1.5 space-y-1">
        {rows.map((p) => (
          <li key={p.id}>
            <RouterLink
              to={`/finance?tab=out&payable=${p.id}`}
              className="flex items-center gap-1.5 rounded-md bg-card px-2 py-1.5 text-[11px] ring-1 ring-line transition-base hover:ring-stage-2"
            >
              <span className="min-w-0 flex-1 truncate text-ink">
                <span className="font-semibold">{p.title}</span>
                <span className="ml-1 text-ink-3">{p.vendor_name}</span>
              </span>
              <span className="shrink-0 rounded-full bg-page px-1.5 py-px font-semibold text-ink-2">
                {p.state_label}
              </span>
              <span className="shrink-0 font-bold tabular-nums text-ink">
                {Number(p.payable_amount).toLocaleString("zh-TW")} 元
              </span>
            </RouterLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** iso 日期加 n 個月（日數超過該月天數就取月底） */
function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const lastDay = new Date(y, m - 1 + n + 1, 0).getDate();
  const dt = new Date(y, m - 1 + n, Math.min(d, lastDay));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/**
 * 從流程卡片直接登錄應付帳款（D45）：金額、付費對象、預計付費日、付款方式。
 * D48 加**分期付款**：選幾期，總額平均拆、日期預設逐月推（每期都能改）——
 * 一期＝一筆應付款（標題帶「第i/N期」），現金流自動按各期日期落格。
 * 建立後自動掛在這個流程與專案上，之後的核可、付款照舊走 金流 → 應付。
 */
function AddPayableForm({ unit, onDone }: { unit: FlowUnit; onDone: () => void }) {
  const { data: options } = useOptions();
  const vendors = useQuery({
    queryKey: ["vendors", "for-payable"],
    queryFn: () =>
      api.get<{ results: Array<{ id: number; name: string }> }>("/vendors", {
        active: "true",
        page_size: 200,
      }),
    staleTime: 5 * 60 * 1000,
  });
  const save = useSavePayable();
  const toast = useToast();
  const [form, setForm] = useState({
    vendor: "",
    amount: "",
    due_date: "",
    payment_method: "transfer",
    category: "",
    title: "",
  });
  const [count, setCount] = useState(1);
  const [rows, setRows] = useState<Array<{ amount: string; due_date: string }>>([]);
  const [sending, setSending] = useState(false);

  /** 期數／總額／首期日一變就重拆（各期可再手改） */
  function regen(n: number, total: string, firstDate: string) {
    if (n <= 1) {
      setRows([]);
      return;
    }
    const shares =
      total && Number(total) > 0 ? splitEvenly(Number(total), n) : Array<string>(n).fill("");
    setRows(
      Array.from({ length: n }, (_, i) => ({
        amount: shares[i] ?? "",
        due_date: firstDate ? addMonths(firstDate, i) : "",
      })),
    );
  }

  const rowsValid = count <= 1 || rows.every((r) => Number(r.amount) > 0);

  async function submit() {
    if (!form.vendor || !form.amount || !form.category || !rowsValid) return;
    const base = {
      project: unit.project,
      flow_unit: unit.id,
      vendor: Number(form.vendor),
      category: form.category,
      payment_method: form.payment_method,
    };
    const title = form.title.trim() || unit.flow_name;
    setSending(true);
    try {
      if (count <= 1) {
        await save.mutateAsync({
          ...base, title, amount: form.amount, due_date: form.due_date || null,
        });
      } else {
        for (let i = 0; i < rows.length; i++) {
          await save.mutateAsync({
            ...base,
            title: `${title}（第${i + 1}/${rows.length}期）`,
            amount: rows[i].amount,
            due_date: rows[i].due_date || null,
          });
        }
      }
      toast.success(
        count <= 1 ? "應付帳款已登錄" : `已登錄 ${rows.length} 期應付款`,
        ["掛在這個流程上；核可與付款到 金流 → 應付，現金流會按各期日期計算"],
      );
      onDone();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.body.detail ?? "登錄失敗" : "登錄失敗");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mb-3 rounded-lg bg-page px-3 py-2.5">
      <p className="text-xs font-semibold text-ink-2">新增應付帳款（掛在這一步）</p>
      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
        <select
          value={form.vendor}
          onChange={(e) => setForm((f) => ({ ...f, vendor: e.target.value }))}
          aria-label="付費對象"
          className="rounded-md border border-line bg-card px-1.5 py-1.5 text-[11px] text-ink"
        >
          <option value="">付費對象（廠商）…</option>
          {(vendors.data?.results ?? []).map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        <input
          type="number"
          inputMode="decimal"
          value={form.amount}
          onChange={(e) => {
            setForm((f) => ({ ...f, amount: e.target.value }));
            regen(count, e.target.value, form.due_date);
          }}
          placeholder={count > 1 ? "總金額（稅後）" : "金額（稅後）"}
          aria-label="金額（稅後實際金額）"
          className="rounded-md border border-line bg-card px-1.5 py-1.5 text-right text-[11px] tabular-nums text-ink"
        />
        <label className="flex items-center gap-1 text-[11px] text-ink-3">
          {count > 1 ? "首期付款日" : "預計付費日"}
          <DateInput
            value={form.due_date}
            onChange={(v) => {
              setForm((f) => ({ ...f, due_date: v }));
              regen(count, form.amount, v);
            }}
            className="min-w-0 flex-1"
            aria-label="預計付費日"
          />
        </label>
        <select
          value={form.payment_method}
          onChange={(e) => setForm((f) => ({ ...f, payment_method: e.target.value }))}
          aria-label="付款方式"
          className="rounded-md border border-line bg-card px-1.5 py-1.5 text-[11px] text-ink"
        >
          {(options?.payment_method ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={form.category}
          onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
          aria-label="類別"
          className="rounded-md border border-line bg-card px-1.5 py-1.5 text-[11px] text-ink"
        >
          <option value="">類別…</option>
          {(options?.subcontract_category ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          placeholder={`項目（預設：${unit.flow_name}）`}
          aria-label="項目"
          className="rounded-md border border-line bg-card px-1.5 py-1.5 text-[11px] text-ink"
        />
        {/* 分期付款（D48）：一期＝一筆應付款，現金流按各期日期落格 */}
        <label className="flex items-center gap-1 text-[11px] text-ink-3">
          分期
          <select
            value={count}
            onChange={(e) => {
              const n = Number(e.target.value);
              setCount(n);
              regen(n, form.amount, form.due_date);
            }}
            aria-label="分幾期付款"
            className="min-w-0 flex-1 rounded-md border border-line bg-card px-1.5 py-1.5 text-[11px] text-ink"
          >
            <option value={1}>一次付清</option>
            {[2, 3, 4, 5, 6, 8, 10, 12].map((n) => (
              <option key={n} value={n}>
                分 {n} 期
              </option>
            ))}
          </select>
        </label>
      </div>

      {count > 1 && rows.length > 0 && (
        <div className="mt-1.5 space-y-1">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="w-10 shrink-0 text-[11px] tabular-nums text-ink-3">
                第{i + 1}期
              </span>
              <input
                type="number"
                inputMode="decimal"
                value={r.amount}
                onChange={(e) =>
                  setRows((prev) => prev.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))
                }
                aria-label={`第 ${i + 1} 期金額`}
                className="w-24 shrink-0 rounded-md border border-line bg-card px-1.5 py-1 text-right text-[11px] tabular-nums text-ink"
              />
              <DateInput
                value={r.due_date}
                onChange={(v) =>
                  setRows((prev) => prev.map((x, j) => (j === i ? { ...x, due_date: v } : x)))
                }
                className="min-w-0 flex-1"
                aria-label={`第 ${i + 1} 期付款日`}
              />
            </div>
          ))}
          <p className="text-[10px] text-ink-3">
            各期合計{" "}
            {rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0).toLocaleString("zh-TW")} 元
            （預設平均拆、逐月推，每期都可以改）
          </p>
        </div>
      )}

      <div className="mt-1.5 flex gap-1.5">
        <Button onClick={onDone} className="flex-1">
          取消
        </Button>
        <Button
          variant="primary"
          onClick={submit}
          loading={sending}
          disabled={!form.vendor || !form.amount || !form.category || !rowsValid}
          className="flex-1"
        >
          {count > 1 ? `登錄 ${count} 期應付款` : "登錄應付款"}
        </Button>
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-ink-3">
        金額一律填稅後的實際金額；之後的核可（經理）與付款（會計師）在 金流 → 應付 操作。
      </p>
    </div>
  );
}

/** 排程：專案管理者在這裡指派負責人、排日期。
 * 總數量／單位已移除（D45）——進度由工作分配算，不再手填分母 */
function ScheduleEditor({ unit }: { unit: FlowUnit }) {
  const { data: options } = useOptions();
  const save = useSaveFlowUnit();
  const toast = useToast();
  const [form, setForm] = useState({
    assignee: unit.assignee ? String(unit.assignee) : "",
    plan_start: unit.plan_start ?? "",
    plan_end: unit.plan_end ?? "",
  });
  const error = save.error instanceof ApiError ? save.error : null;

  const dirty =
    form.assignee !== (unit.assignee ? String(unit.assignee) : "") ||
    form.plan_start !== (unit.plan_start ?? "") ||
    form.plan_end !== (unit.plan_end ?? "");

  function submit() {
    save.mutate(
      {
        id: unit.id,
        assignee: form.assignee ? Number(form.assignee) : null,
        plan_start: form.plan_start || null,
        plan_end: form.plan_end || null,
      },
      {
        onSuccess: () => {
          toast.success("排程已更新", [
            form.assignee && String(unit.assignee ?? "") !== form.assignee
              ? "負責人會收到站內通知"
              : "",
          ].filter(Boolean));
        },
      },
    );
  }

  return (
    <div className="mb-3 rounded-xl bg-page p-3">
      <p className="mb-2 text-xs font-semibold text-ink-2">排程</p>
      <Field label="主要負責人" hint="指派後對方會在「我的任務」看到，並收到通知">
        <select
          value={form.assignee}
          onChange={(e) => setForm((f) => ({ ...f, assignee: e.target.value }))}
          className={inputClass}
        >
          <option value="">未指派</option>
          {(options?.users ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="預計開始">
          <DateInput
            value={form.plan_start}
            onChange={(v) => setForm((f) => ({ ...f, plan_start: v }))}
          />
        </Field>
        <Field label="預計完成" error={error?.fieldError("plan_end")}>
          <DateInput
            value={form.plan_end}
            onChange={(v) => setForm((f) => ({ ...f, plan_end: v }))}
          />
        </Field>
      </div>
      <div className="flex">
        <Button
          variant="primary"
          onClick={submit}
          loading={save.isPending}
          disabled={!dirty}
          className="flex-1"
        >
          儲存排程
        </Button>
      </div>
    </div>
  );
}
