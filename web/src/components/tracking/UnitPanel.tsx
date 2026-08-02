/**
 * 追蹤單元操作面板
 *
 * 這是整個系統實際「做事」的地方——推進、回退、回報進度、登錄簽收
 * 全部收在同一個面板裡，因為使用者心裡想的是「處理這一批」，
 * 不是「我要去回報進度那個功能」。
 *
 * 按鈕顯不顯示由後端的 can_* 決定，前端不重寫一次權限判斷。
 */
import { ArrowLeft, ArrowRight, History, Minus, Pencil, PenLine, Plus } from "lucide-react";
import { useState } from "react";

import { ApiError } from "@/api/client";
import {
  useMoveStage,
  useReportProgress,
  useSignoff,
  useStageLogs,
  useTrackingUnit,
} from "@/api/hooks";
import { useCurrentUser } from "@/api/hooks/useAuth";
import type { TrackingCard } from "@/api/types";
import UnitForm from "@/components/forms/UnitForm";
import {
  Button,
  DisabledHint,
  Field,
  FormErrors,
  inputClass,
  Modal,
  ProgressBar,
  Select,
  Spinner,
  StatusBadge,
} from "@/components/ui";
import { describeSideEffects, useToast } from "@/components/ui/Toast";

export type PanelMode = "view" | "advance" | "rollback" | "report" | "signoff" | "history";
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
        ) : mode === "signoff" ? (
          <SignoffMode detail={detail} back={() => setMode("view")} />
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
        {detail.phase_name && <span className="text-ink-3">· {detail.phase_name}</span>}
        <StatusBadge status={detail.status} size="xs" />
        {user?.permissions.edit_tracking && (
          <button
            type="button"
            onClick={onEdit}
            className="ml-auto flex h-7 min-h-0 items-center gap-1 rounded-lg px-2
                       text-[11px] font-semibold text-ink-2 hover:bg-page"
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
              className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold"
              style={{
                background: current ? stage.color : done ? "var(--color-page)" : "transparent",
                color: current ? "#fff" : done ? "var(--color-ink-2)" : "var(--color-ink-3)",
                border: current ? "none" : "1px solid var(--color-line)",
              }}
              aria-current={current ? "step" : undefined}
            >
              {stage.name}
              {stage.requires_signoff && <PenLine size={10} aria-label="需簽收" />}
              {stage.is_billing_trigger && <span aria-label="觸發請款">💰</span>}
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
        <p className="mt-1 text-[11px] text-ink-3">
          這是<strong>目前這一站</strong>的進度，換站會歸零重算。
          整體進度看上面的階段軌道（第 {detail.stage_seq}／{detail.stage_total} 站）。
        </p>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <Row label="目前階段" value={`${detail.stage_name}（第 ${detail.stage_seq} / ${detail.stage_total} 站）`} />
        <Row label="停留天數" value={`${detail.days_in_stage} 天`} />
        <Row label="負責人" value={detail.assignee_name || "未指派"} />
        <Row label="預計完成" value={detail.plan_end ?? "未設定"} />
        {detail.total_weight_kg && (
          <Row label="總重量" value={`${(Number(detail.total_weight_kg) / 1000).toFixed(1)} 噸`} />
        )}
        {detail.outsource_vendor_name && (
          <Row
            label="外包協力廠"
            value={`${detail.outsource_vendor_name}${
              detail.outsource_due_date ? `（預計 ${detail.outsource_due_date} 回廠）` : ""
            }`}
          />
        )}
        {detail.signoff_date && (
          <Row
            label="簽收"
            value={`${detail.signoff_date} · ${detail.signoff_by_name}${
              detail.signoff_doc_no ? ` · ${detail.signoff_doc_no}` : ""
            }`}
          />
        )}
      </dl>

      {detail.is_awaiting_signoff && (
        <p
          className="mt-3 rounded-lg px-3 py-2 text-xs leading-relaxed"
          style={{ background: "var(--color-atrisk-bg)", color: "var(--color-atrisk)" }}
        >
          已進場，等待業主／監造簽收。<strong>登錄簽收後才會觸發請款</strong>。
        </p>
      )}

      <div className="mt-5 grid grid-cols-2 gap-2">
        {detail.can_report && (
          <Button onClick={() => setMode("report")}>
            <Plus size={14} />
            回報進度
          </Button>
        )}
        {detail.can_signoff && (
          <Button variant="primary" onClick={() => setMode("signoff")}>
            <PenLine size={14} />
            登錄簽收
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
  const [reason, setReason] = useState("");
  const move = useMoveStage();
  const toast = useToast();
  const target = detail.stages.find(
    (s) => s.seq === detail.stage_seq + (direction === "forward" ? 1 : -1),
  );
  const error = move.error instanceof ApiError ? move.error : null;
  const blocked = direction === "backward" && (!reason || !note.trim());

  function submit() {
    move.mutate(
      {
        id: detail.id,
        direction,
        note,
        reason_category: reason,
        expected_stage_id: detail.stage_id,
      },
      {
        onSuccess: (result) => {
          const { severity, lines } = describeSideEffects(result);
          toast.show(
            `${detail.name} ${direction === "forward" ? "已推進至" : "已退回"} ${result.unit.stage_name}`,
            { severity, lines },
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

      {direction === "backward" && (
        <>
          <p
            className="mb-3 rounded-lg px-3 py-2 text-xs leading-relaxed"
            style={{ background: "var(--color-atrisk-bg)", color: "var(--color-atrisk)" }}
          >
            回退會把這一批標記為「注意」，第二次回退升級為「延誤」，並通知專案負責人。
            原因會計入品質失敗成本統計。
          </p>
          <Field label="回退原因" required>
            <Select
              value={reason}
              onChange={setReason}
              options={detail.rollback_reasons}
              placeholder="請選擇"
              className="w-full"
            />
          </Field>
        </>
      )}

      <Field
        label="說明"
        required={direction === "backward"}
        hint={direction === "backward" ? "寫清楚發生什麼事，之後查得回來" : "選填"}
      >
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className={inputClass}
        />
      </Field>

      <FormErrors error={error} />

      <DisabledHint show={blocked}>
        {!reason ? "請先選擇回退原因" : "請填寫說明後才能送出"}
      </DisabledHint>

      <div className="flex gap-2">
        <Button onClick={back} className="flex-1">
          取消
        </Button>
        <Button
          variant={direction === "forward" ? "primary" : "danger"}
          onClick={submit}
          loading={move.isPending}
          disabled={blocked}
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

// ── 登錄簽收 ───────────────────────────────────────────────────────
function SignoffMode({ detail, back }: { detail: Detail; back: () => void }) {
  const [name, setName] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [docNo, setDocNo] = useState("");
  const signoff = useSignoff();
  const toast = useToast();
  const error = signoff.error instanceof ApiError ? signoff.error : null;

  function submit() {
    signoff.mutate(
      { id: detail.id, signoff_by_name: name.trim(), signoff_date: date, signoff_doc_no: docNo },
      {
        onSuccess: (result) => {
          const { severity, lines } = describeSideEffects(result);
          toast.show(`${detail.name} 已登錄簽收`, {
            severity: result.billing.triggered ? "good" : severity,
            lines: [result.billing.progress_text, ...lines],
          });
          back();
        },
      },
    );
  }

  return (
    <div>
      <p
        className="mb-4 rounded-lg px-3 py-2 text-xs leading-relaxed"
        style={{ background: "var(--color-ontrack-bg)", color: "var(--color-ontrack)" }}
      >
        這是<strong>業主／監造簽收</strong>的紀錄，不是我們送達的紀錄。
        簽收後系統會依合約條件判斷要不要轉為可請款。
      </p>

      <Field label="簽收人" required hint="業主或監造單位實際簽名的人">
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </Field>
      <Field label="簽收日期" required>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="簽收單號" hint="選填，之後對帳用">
        <input value={docNo} onChange={(e) => setDocNo(e.target.value)} className={inputClass} />
      </Field>

      <FormErrors error={error} />

      <div className="flex gap-2">
        <Button onClick={back} className="flex-1">
          取消
        </Button>
        <Button
          variant="primary"
          onClick={submit}
          loading={signoff.isPending}
          disabled={!name.trim()}
          className="flex-1"
        >
          登錄簽收
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
                {log.reason_label && <p className="text-ink-2">原因：{log.reason_label}</p>}
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
