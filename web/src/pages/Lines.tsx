/**
 * 產線
 *
 * 回答的問題：**機台現在在忙什麼**。
 *
 * ⚠️ P1 的資料是廠長人工填的，不是系統算的。畫面上直接寫明這件事——
 * 一個看起來很自動的數字如果其實是手打的，比沒有這個數字更危險。
 */
import { Factory, Pencil } from "lucide-react";
import { useState } from "react";

import { useLines, useOptions, useUpdateLine } from "@/api/hooks";
import { useCurrentUser } from "@/api/hooks/useAuth";
import type { ProductionLine } from "@/api/types";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  inputClass,
  Modal,
  ProgressBar,
  Select,
  Spinner,
} from "@/components/ui";
import { useToast } from "@/components/ui/Toast";

const STATUS_COLOR: Record<string, string> = {
  run: "var(--color-ontrack)",
  changeover: "var(--color-atrisk)",
  repair: "var(--color-delayed)",
  idle: "var(--color-ink-3)",
};

export default function Lines() {
  const { data: user } = useCurrentUser();
  const { data, isLoading, error, refetch } = useLines();
  const [editing, setEditing] = useState<ProductionLine | null>(null);
  const canEdit = Boolean(user?.permissions.edit_lines);

  if (isLoading) return <Spinner />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!data) return null;

  return (
    <div>
      <div className="mb-3 grid grid-cols-3 gap-2">
        <Stat label="產線數" value={data.summary.total} />
        <Stat
          label="運轉中"
          value={data.summary.running}
          color={data.summary.running ? "var(--color-ontrack)" : undefined}
        />
        <Stat
          label="平均稼動率"
          value={data.summary.avg_utilization !== null ? `${data.summary.avg_utilization}%` : "—"}
        />
      </div>

      {data.results.length === 0 ? (
        <EmptyState title="尚未建立產線" hint="請由系統管理員在後台新增" />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {data.results.map((line) => (
            <Card as="li" key={line.id} className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-bold text-ink">
                    <Factory size={14} className="text-ink-3" />
                    {line.name}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-ink-3">{line.code}</p>
                </div>
                <span
                  className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5
                             text-[11px] font-semibold"
                  style={{
                    color: STATUS_COLOR[line.status],
                    background: "var(--color-page)",
                  }}
                >
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: STATUS_COLOR[line.status] }}
                  />
                  {line.status_label}
                </span>
              </div>

              <p className="mt-2 text-xs text-ink-2">
                {line.current_work || <span className="text-ink-3">目前沒有指定工單</span>}
              </p>

              {line.utilization !== null && (
                <div className="mt-2">
                  <ProgressBar
                    value={Number(line.utilization)}
                    label="稼動率"
                    compact
                    color={
                      Number(line.utilization) >= 70
                        ? "var(--color-ontrack)"
                        : "var(--color-atrisk)"
                    }
                  />
                </div>
              )}

              <div className="mt-2 flex items-end justify-between gap-2">
                <p className="text-[11px] text-ink-3">
                  {line.today_output && `今日 ${line.today_output} · `}
                  {line.updated_by_name && `${line.updated_by_name} 更新`}
                </p>
                {canEdit && (
                  <Button variant="ghost" onClick={() => setEditing(line)}>
                    <Pencil size={13} />
                    更新
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </ul>
      )}

      <p className="mt-3 text-[11px] text-ink-3">
        資料來源：{data.data_source}
      </p>

      <EditDialog line={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <Card className="p-3">
      <p className="text-[11px] text-ink-3">{label}</p>
      <p className="mt-0.5 text-xl font-bold tabular-nums" style={{ color: color ?? "var(--color-ink)" }}>
        {value}
      </p>
    </Card>
  );
}

function EditDialog({ line, onClose }: { line: ProductionLine | null; onClose: () => void }) {
  const { data: options } = useOptions();
  const update = useUpdateLine();
  const toast = useToast();
  const [form, setForm] = useState({ status: "", current_work: "", utilization: "", today_output: "" });

  // 開啟時帶入目前值
  const [loadedId, setLoadedId] = useState<number | null>(null);
  if (line && loadedId !== line.id) {
    setLoadedId(line.id);
    setForm({
      status: line.status,
      current_work: line.current_work,
      utilization: line.utilization ?? "",
      today_output: line.today_output,
    });
  }

  function submit() {
    if (!line) return;
    update.mutate(
      { id: line.id, ...form, utilization: form.utilization || undefined },
      {
        onSuccess: () => {
          toast.success(`${line.name} 已更新`);
          onClose();
        },
      },
    );
  }

  return (
    <Modal open={line !== null} onClose={onClose} title={`更新 ${line?.name ?? ""}`}>
      <Field label="狀態" required>
        <Select
          value={form.status}
          onChange={(v) => setForm((f) => ({ ...f, status: v }))}
          options={options?.line_status ?? []}
          className="w-full"
        />
      </Field>
      <Field label="當前工單" hint="P1 為純文字，P3 導入工單後改為選單">
        <input
          value={form.current_work}
          onChange={(e) => setForm((f) => ({ ...f, current_work: e.target.value }))}
          className={inputClass}
        />
      </Field>
      <Field label="稼動率 (%)" hint="P3 導入報工後由系統自動計算">
        <input
          type="number"
          inputMode="decimal"
          min={0}
          max={100}
          value={form.utilization}
          onChange={(e) => setForm((f) => ({ ...f, utilization: e.target.value }))}
          className={inputClass}
        />
      </Field>
      <Field label="今日產出">
        <input
          value={form.today_output}
          onChange={(e) => setForm((f) => ({ ...f, today_output: e.target.value }))}
          className={inputClass}
        />
      </Field>

      <div className="flex gap-2">
        <Button onClick={onClose} className="flex-1">
          取消
        </Button>
        <Button variant="primary" onClick={submit} loading={update.isPending} className="flex-1">
          儲存
        </Button>
      </div>
    </Modal>
  );
}
