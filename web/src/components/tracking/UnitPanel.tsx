/**
 * 追蹤單元操作面板
 *
 * 這是「補登進度」的地方——推進、回退、回報進度
 * 全部收在同一個面板裡，因為使用者心裡想的是「處理這一批」，
 * 不是「我要去回報進度那個功能」。
 *
 * 按鈕顯不顯示由後端的 can_* 決定，前端不重寫一次權限判斷。
 */
import { ArrowLeft, ArrowRight, History, Minus, Pencil, Plus } from "lucide-react";
import { useState } from "react";

import { ApiError } from "@/api/client";
import {
  useMoveStage,
  useReportProgress,
  useStageLogs,
  useTrackingUnit,
} from "@/api/hooks";
import { useCurrentUser } from "@/api/hooks/useAuth";
import type { TrackingCard } from "@/api/types";
import AttachmentSection from "@/components/attachments/AttachmentSection";
import UnitForm from "@/components/forms/UnitForm";
import {
  Button,
  Field,
  FormErrors,
  inputClass,
  Modal,
  ProgressBar,
  Spinner,
  StatusBadge,
} from "@/components/ui";
import { useToast } from "@/components/ui/Toast";

export type PanelMode = "view" | "advance" | "rollback" | "report" | "history";
type Mode = PanelMode;

export default function UnitPanel({
  unit,
  onClose,
  initialMode = "view",
}: {
  unit: TrackingCard | null;
  onClose: () => void;
  /** 直接開在某個動作。「我的工作」的卡片按鈕用這個少點一次 */
  initialMode?: PanelMode;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [editing, setEditing] = useState(false);
  const [openedFor, setOpenedFor] = useState<number | null>(null);
  const { data: detail, isLoading } = useTrackingUnit(unit?.id ?? null);

  // 每次開啟（或換一張卡）都重設成呼叫端指定的模式
  if (unit && openedFor !== unit.id) {
    setOpenedFor(unit.id);
    setMode(initialMode);
  }
  if (!unit && openedFor !== null) setOpenedFor(null);

  function close() {
    setMode("view");
    onClose();
  }

  return (
    <>
      <Modal open={unit !== null && !editing} onClose={close} title={unit?.name ?? ""}>
        {isLoading || !detail ? (
          <Spinner />
        ) : mode === "view" ? (
          <ViewMode detail={detail} setMode={setMode} onEdit={() => setEditing(true)} />
        ) : mode === "history" ? (
          <HistoryMode id={detail.id} back={() => setMode("view")} />
        ) : mode === "report" ? (
          <ReportMode detail={detail} back={() => setMode("view")} />
        ) : (
          <MoveMode
            detail={detail}
            direction={mode === "advance" ? "forward" : "backward"}
            back={() => setMode("view")}
          />
        )}
      </Modal>

      <UnitForm open={editing} onClose={() => setEditing(false)} unit={detail} />
    </>
  );
}

type Detail = NonNullable<ReturnType<typeof useTrackingUnit>["data"]>;

// ── 檢視 ───────────────────────────────────────────────────────────
function ViewMode({
  detail,
  setMode,
  onEdit,
}: {
  detail: Detail;
  setMode: (m: Mode) => void;
  onEdit: () => void;
}) {
  const nextStage = detail.stages.find((s) => s.seq === detail.stage_seq + 1);
  const prevStage = detail.stages.find((s) => s.seq === detail.stage_seq - 1);
  const { data: user } = useCurrentUser();

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
        <span className="font-mono text-ink-3">{detail.code}</span>
        <span>{detail.project_name}</span>
        <StatusBadge status={detail.status} size="xs" />
        {user?.permissions.edit_tracking && (
          <button
            type="button"
            onClick={onEdit}
            className="ml-auto flex h-7 min-h-0 items-center gap-1 rounded-lg px-2
                       text-xs font-semibold text-ink-2 hover:bg-page"
          >
            <Pencil size={12} />
            編輯
          </button>
        )}
      </div>

      {/* 階段軌道：走到哪一站，一眼看完 */}
      <ol className="scroll-x mt-4 flex gap-1 pb-1">
        {detail.stages.map((stage) => {
          const done = stage.seq < detail.stage_seq;
          const current = stage.seq === detail.stage_seq;
          return (
            <li
              key={stage.id}
              className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold"
              style={{
                background: current ? stage.color : done ? "var(--color-page)" : "transparent",
                color: current ? "#fff" : done ? "var(--color-ink-2)" : "var(--color-ink-3)",
                border: current ? "none" : "1px solid var(--color-line)",
              }}
              aria-current={current ? "step" : undefined}
            >
              {stage.name}
            </li>
          );
        })}
      </ol>

      <div className="mt-4">
        <ProgressBar
          value={detail.completion_ratio}
          label={
            detail.unit_type === "batch"
              ? `「${detail.stage_name}」完成 ${Number(detail.qty_done)} / ${Number(detail.qty_total)} ${detail.unit_of_measure}`
              : `「${detail.stage_name}」完成度`
          }
        />
        <p className="mt-1 text-xs text-ink-3">
          這是<strong>目前這一站</strong>的進度，換站會歸零重算。
          整體進度看上面的階段軌道（第 {detail.stage_seq}／{detail.stage_total} 站）。
        </p>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <Row label="目前階段" value={`${detail.stage_name}（第 ${detail.stage_seq} / ${detail.stage_total} 站）`} />
        <Row label="停留天數" value={`${detail.days_in_stage} 天`} />
        {detail.subcontractor_name && <Row label="分包商" value={detail.subcontractor_name} />}
        <Row label="預計完成" value={detail.plan_end ?? "未設定"} />
      </dl>

      <div className="mt-5 grid grid-cols-2 gap-2">
        {detail.can_report && (
          <Button onClick={() => setMode("report")}>
            <Plus size={14} />
            回報進度
          </Button>
        )}
        {detail.can_advance && (
          <Button variant="primary" onClick={() => setMode("advance")}>
            <ArrowRight size={14} />
            推進至{nextStage?.name}
          </Button>
        )}
        {detail.can_rollback && (
          <Button onClick={() => setMode("rollback")}>
            <ArrowLeft size={14} />
            退回{prevStage?.name}
          </Button>
        )}
        <Button variant="ghost" onClick={() => setMode("history")} className="col-span-2">
          <History size={14} />
          查看異動歷程
        </Button>
      </div>

      {/* 現場照片、檢驗報告、簽收單掃描。
          簽收單特別重要：日後業主說「沒收到」，系統裡有簽收人、日期、單號，
          再加上那張單的照片，爭議就結束了 */}
      <div className="mt-4">
        <AttachmentSection target="tracking-unit" id={detail.id} defaultCategory="photo" compact />
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-ink-3">{label}</dt>
      <dd className="mt-0.5 font-semibold text-ink">{value}</dd>
    </div>
  );
}

// ── 推進／回退 ─────────────────────────────────────────────────────
function MoveMode({
  detail,
  direction,
  back,
}: {
  detail: Detail;
  direction: "forward" | "backward";
  back: () => void;
}) {
  const [note, setNote] = useState("");
  const move = useMoveStage();
  const toast = useToast();
  const target = detail.stages.find(
    (s) => s.seq === detail.stage_seq + (direction === "forward" ? 1 : -1),
  );
  const error = move.error instanceof ApiError ? move.error : null;

  function submit() {
    move.mutate(
      {
        id: detail.id,
        direction,
        note,
        expected_stage_id: detail.stage_id,
      },
      {
        onSuccess: (result) => {
          toast.success(
            `${detail.name} ${direction === "forward" ? "已推進至" : "已退回"} ${result.unit.stage_name}`,
          );
          back();
        },
      },
    );
  }

  return (
    <div>
      <p className="mb-4 text-sm text-ink-2">
        {detail.stage_name} → <strong className="text-ink">{target?.name}</strong>
      </p>

      <Field
        label="說明"
        hint={direction === "backward" ? "退回原因寫一下，之後查得回來" : "選填"}
      >
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className={inputClass}
        />
      </Field>

      <FormErrors error={error} />

      <div className="flex gap-2">
        <Button onClick={back} className="flex-1">
          取消
        </Button>
        <Button
          variant={direction === "forward" ? "primary" : "danger"}
          onClick={submit}
          loading={move.isPending}
          className="flex-1"
        >
          確定{direction === "forward" ? "推進" : "回退"}
        </Button>
      </div>
    </div>
  );
}

// ── 回報進度 ───────────────────────────────────────────────────────
function ReportMode({ detail, back }: { detail: Detail; back: () => void }) {
  const isBatch = detail.unit_type === "batch";
  const [delta, setDelta] = useState(0);
  const [pct, setPct] = useState(String(detail.completion_ratio));
  const [note, setNote] = useState("");
  const report = useReportProgress();
  const toast = useToast();
  const error = report.error instanceof ApiError ? report.error : null;

  const done = Number(detail.qty_done);
  const total = Number(detail.qty_total ?? 0);
  const preview = Math.max(0, Math.min(total, done + delta));

  function submit() {
    report.mutate(
      isBatch
        ? { id: detail.id, delta: String(delta), note }
        : { id: detail.id, progress_pct: pct, note },
      {
        onSuccess: (result) => {
          toast.success(
            `${detail.name} 進度已更新為 ${result.unit.completion_ratio}%`,
            result.suggestion ? [result.suggestion.message] : [],
          );
          back();
        },
      },
    );
  }

  return (
    <div>
      {isBatch ? (
        <>
          <p className="text-xs text-ink-2">
            「{detail.stage_name}」這一站目前 {done} / {total} {detail.unit_of_measure}
          </p>
          {/* 快速按鈕的級距由後端依單位決定（噸給 0.5/1/5，支給 1/5/10）——
              前端不寫「如果單位是噸就…」這種判斷 */}
          <div className="mt-3 flex flex-wrap gap-2">
            {detail.quick_increments.map((step) => (
              <Button key={step} onClick={() => setDelta((d) => d + step)}>
                <Plus size={13} />
                {step}
              </Button>
            ))}
            <Button onClick={() => setDelta((d) => d - 1)}>
              <Minus size={13} />1
            </Button>
            <Button variant="ghost" onClick={() => setDelta(0)}>
              歸零
            </Button>
          </div>

          <div className="mt-4 rounded-lg bg-page p-3 text-center">
            <p className="text-xs text-ink-2">送出後</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-ink">
              {preview} / {total} {detail.unit_of_measure}
              <span className="ml-2 text-sm font-semibold text-ink-2">
                {total ? ((preview / total) * 100).toFixed(0) : 0}%
              </span>
            </p>
            <p className="mt-0.5 text-xs text-ink-3">
              增減 {delta >= 0 ? "+" : ""}
              {delta}
            </p>
          </div>
        </>
      ) : (
        <Field label="完成百分比" required hint="土建工項以監造查驗通過的完成度為準">
          <input
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            value={pct}
            onChange={(e) => setPct(e.target.value)}
            className={inputClass}
          />
        </Field>
      )}

      <div className="mt-4">
        <Field
          label="備註"
          required={isBatch ? delta < 0 : Number(pct) < detail.completion_ratio}
          hint="數值調降時必填"
        >
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      <FormErrors error={error} />

      <div className="flex gap-2">
        <Button onClick={back} className="flex-1">
          取消
        </Button>
        <Button
          variant="primary"
          onClick={submit}
          loading={report.isPending}
          disabled={isBatch && delta === 0}
          className="flex-1"
        >
          送出
        </Button>
      </div>
    </div>
  );
}

// ── 歷程 ───────────────────────────────────────────────────────────
function HistoryMode({ id, back }: { id: number; back: () => void }) {
  const { data: logs, isLoading } = useStageLogs(id);

  return (
    <div>
      {isLoading ? (
        <Spinner />
      ) : !logs?.length ? (
        <p className="py-6 text-center text-sm text-ink-3">尚無異動紀錄</p>
      ) : (
        <ol className="space-y-3">
          {logs.map((log) => (
            <li key={log.id} className="flex gap-2 text-xs">
              <span
                className="mt-1 h-2 w-2 shrink-0 rounded-full"
                style={{
                  background: log.is_rollback
                    ? "var(--color-delayed)"
                    : "var(--color-stage-2)",
                }}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink">
                  {log.from_stage_name ? `${log.from_stage_name} → ` : ""}
                  {log.to_stage_name}
                  {log.is_rollback && (
                    <span className="ml-1" style={{ color: "var(--color-delayed)" }}>
                      （回退）
                    </span>
                  )}
                </p>
                {log.qty_at_exit != null && (
                  <p className="text-ink-2">離開時完成 {Number(log.qty_at_exit)}</p>
                )}
                {log.pct_at_exit != null && (
                  <p className="text-ink-2">離開時完成度 {Number(log.pct_at_exit)}%</p>
                )}
                {log.note && <p className="text-ink-2">{log.note}</p>}
                <p className="mt-0.5 text-ink-3">
                  {new Date(log.moved_at).toLocaleString("zh-TW")} · {log.moved_by_name}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
      <Button onClick={back} className="mt-4 w-full">
        返回
      </Button>
    </div>
  );
}
