/**
 * 變更追加單
 *
 * 合約金額改變的**唯一合法途徑**。
 *
 * 為什麼不直接改專案的「合約金額」欄位：改了就沒人知道為什麼改、誰准的。
 * 走變更單的話，每一次調整都有標題、原因、核准人、核准時間——
 * 日後對帳或爭議時查得出來。
 *
 * 核准後會**自動重算尚未請款的里程碑金額**，因為
 * 里程碑金額 ＝ 有效合約額 × 比例。已經請款的不動——送出去的數字不能被改掉。
 */
import { AlertTriangle, Check, Pencil, Plus, Send, X } from "lucide-react";
import { useState } from "react";

import { ApiError, api } from "@/api/client";
import { useCurrentUser } from "@/api/hooks/useAuth";
import type { ChangeOrder, ProjectDetail } from "@/api/types";
import {
  Button,
  Card,
  Field,
  FormErrors,
  inputClass,
  Modal,
  Money,
  SectionTitle,
} from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const STATUS_STYLE: Record<string, { color: string; bg: string }> = {
  draft: { color: "var(--color-ink-2)", bg: "var(--color-page)" },
  submitted: { color: "var(--color-atrisk)", bg: "var(--color-atrisk-bg)" },
  approved: { color: "var(--color-ontrack)", bg: "var(--color-ontrack-bg)" },
  rejected: { color: "var(--color-delayed)", bg: "var(--color-delayed-bg)" },
};

export function useChangeOrders(projectId: number) {
  return useQuery({
    queryKey: ["change-orders", projectId],
    queryFn: () =>
      api.get<{ results: ChangeOrder[] }>("/change-orders", { project: projectId }),
  });
}

export default function ChangeOrderSection({ project }: { project: ProjectDetail }) {
  const { data: user } = useCurrentUser();
  const { data } = useChangeOrders(project.id);
  const [editing, setEditing] = useState<ChangeOrder | null>(null);
  const [creating, setCreating] = useState(false);
  const [approving, setApproving] = useState<ChangeOrder | null>(null);

  const orders = data?.results ?? [];
  const canEdit = project.can_edit;
  const canApprove = Boolean(user?.permissions.approve_change_order);

  // 沒有變更單、也沒有權限建 → 這一區對這個人沒有意義，不顯示
  if (!orders.length && !canEdit) return null;

  return (
    <div className="mt-4">
      <SectionTitle
        action={
          canEdit ? (
            <Button variant="ghost" onClick={() => setCreating(true)}>
              <Plus size={13} />
              新增變更單
            </Button>
          ) : undefined
        }
      >
        變更追加單
      </SectionTitle>

      {orders.length === 0 ? (
        <p className="rounded-lg bg-page px-3 py-2 text-xs leading-relaxed text-ink-2">
          合約金額要改，走這裡。<strong>直接改專案的合約金額是不行的</strong>——
          改了沒人知道為什麼改、誰准的。核准後有效合約額會變，
          <strong>尚未請款的里程碑金額自動重算</strong>。
        </p>
      ) : (
        <ul className="space-y-2">
          {orders.map((co) => (
            <Row
              key={co.id}
              order={co}
              canEdit={canEdit}
              canApprove={canApprove}
              onEdit={setEditing}
              onApprove={setApproving}
            />
          ))}
        </ul>
      )}

      {project.approved_change_amount && Number(project.approved_change_amount) !== 0 && (
        <p className="mt-2 text-xs text-ink-2">
          原合約 <Money value={project.contract_amount} compact />
          {" ＋ 已核准變更 "}
          <Money value={project.approved_change_amount} compact />
          {" ＝ 有效合約額 "}
          <strong className="text-ink">
            <Money value={project.effective_amount} compact />
          </strong>
        </p>
      )}

      <ChangeOrderForm
        open={creating || editing !== null}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        project={project}
        order={editing}
      />
      <ApproveDialog
        order={approving}
        project={project}
        onClose={() => setApproving(null)}
      />
    </div>
  );
}

function Row({
  order,
  canEdit,
  canApprove,
  onEdit,
  onApprove,
}: {
  order: ChangeOrder;
  canEdit: boolean;
  canApprove: boolean;
  onEdit: (o: ChangeOrder) => void;
  onApprove: (o: ChangeOrder) => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const style = STATUS_STYLE[order.status] ?? STATUS_STYLE.draft;

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.patch<ChangeOrder>(`/change-orders/${order.id}`, body),
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ["change-orders"] });
      toast.success(`${saved.code} → ${saved.status_label}`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.body.detail : "操作失敗"),
  });

  return (
    <Card as="li" className="p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-ink">{order.title}</p>
          <p className="mt-0.5 text-xs text-ink-3">
            {order.code}
            {order.approved_by_name && ` · ${order.approved_by_name} 核准`}
            {order.approved_at && ` · ${new Date(order.approved_at).toLocaleDateString("zh-TW")}`}
          </p>
        </div>
        <div className="text-right">
          <p
            className="text-base font-bold tabular-nums"
            style={{ color: Number(order.amount) < 0 ? "var(--color-delayed)" : "var(--color-ink)" }}
          >
            {Number(order.amount) > 0 && "＋"}
            <Money value={order.amount} />
          </p>
          <span
            className="rounded px-1.5 py-0.5 text-xs font-semibold"
            style={{ color: style.color, background: style.bg }}
          >
            {order.status_label}
          </span>
        </div>
      </div>

      {order.reason && <p className="mt-1.5 text-xs leading-relaxed text-ink-2">{order.reason}</p>}

      <div className="mt-2.5 flex flex-wrap gap-2">
        {canEdit && order.status === "draft" && (
          <>
            <Button onClick={() => onEdit(order)}>
              <Pencil size={13} />
              修改
            </Button>
            <Button
              variant="primary"
              onClick={() => patch.mutate({ status: "submitted" })}
              loading={patch.isPending}
            >
              <Send size={13} />
              送簽
            </Button>
          </>
        )}
        {order.status === "submitted" && canApprove && (
          <>
            <Button variant="primary" onClick={() => onApprove(order)}>
              <Check size={13} />
              核准
            </Button>
            <Button
              variant="danger"
              onClick={() => patch.mutate({ status: "rejected" })}
              loading={patch.isPending}
            >
              <X size={13} />
              駁回
            </Button>
          </>
        )}
        {order.status === "submitted" && !canApprove && (
          <span className="text-xs text-ink-3">等待經理核准</span>
        )}
      </div>
    </Card>
  );
}

function ChangeOrderForm({
  open,
  onClose,
  project,
  order,
}: {
  open: boolean;
  onClose: () => void;
  project: ProjectDetail;
  order: ChangeOrder | null;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({ title: "", amount: "", reason: "" });
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  const key = order ? `edit-${order.id}` : "new";
  if (open && loadedKey !== key) {
    setLoadedKey(key);
    setForm(
      order
        ? { title: order.title, amount: order.amount ?? "", reason: order.reason }
        : { title: "", amount: "", reason: "" },
    );
  }
  if (!open && loadedKey !== null) setLoadedKey(null);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      order
        ? api.patch<ChangeOrder>(`/change-orders/${order.id}`, body)
        : api.post<ChangeOrder>("/change-orders", body),
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ["change-orders"] });
      toast.success(order ? `${saved.code} 已更新` : `已建立 ${saved.code}`, [
        order ? "" : "還是草稿。確認內容後按「送簽」",
      ].filter(Boolean));
      onClose();
    },
  });
  const error = save.error instanceof ApiError ? save.error : null;

  const base = Number(project.effective_amount ?? 0);
  const delta = Number(form.amount || 0);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal open={open} onClose={onClose} title={order ? "修改變更單" : "新增變更追加單"}>
      <p className="mb-4 rounded-lg bg-page px-3 py-2 text-xs leading-relaxed text-ink-2">
        合約金額改變的<strong>唯一合法途徑</strong>。核准後有效合約額會變，
        <strong>尚未請款的里程碑金額自動重算</strong>；已經請款的不動——
        送出去的數字不能被改掉。
      </p>

      <Field label="標題" required error={error?.fieldError("title")}>
        <input
          value={form.title}
          onChange={(e) => set("title")(e.target.value)}
          placeholder="如「業主追加 2F 夾層鋼構」"
          className={inputClass}
        />
      </Field>

      <Field
        label="變更金額"
        required
        hint={
          delta
            ? `有效合約額 ${base.toLocaleString("zh-TW")} → ${(base + delta).toLocaleString("zh-TW")} 元`
            : "追加填正數，減帳填負數（如 -500000）"
        }
        error={error?.fieldError("amount")}
      >
        <input
          type="number"
          inputMode="numeric"
          value={form.amount}
          onChange={(e) => set("amount")(e.target.value)}
          className={inputClass}
        />
      </Field>

      <Field label="變更原因" required hint="寫清楚為什麼要改。日後對帳或爭議時，這一欄就是依據">
        <textarea
          rows={3}
          value={form.reason}
          onChange={(e) => set("reason")(e.target.value)}
          className={inputClass}
        />
      </Field>

      <FormErrors error={error} handled={["title", "amount", "reason"]} />

      <div className="flex gap-2">
        <Button onClick={onClose} className="flex-1">
          取消
        </Button>
        <Button
          variant="primary"
          onClick={() =>
            save.mutate({
              project: project.id,
              title: form.title.trim(),
              amount: form.amount,
              reason: form.reason.trim(),
              status: "draft",
            })
          }
          loading={save.isPending}
          disabled={!form.title.trim() || !form.amount || !form.reason.trim()}
          className="flex-1"
        >
          {order ? "儲存" : "建立草稿"}
        </Button>
      </div>
    </Modal>
  );
}

/**
 * 核准前先把後果講清楚
 *
 * 核准會改變有效合約額並重算里程碑金額。這種會連動到錢的操作，
 * 不該只是一個按鈕點下去就發生——先算給他看，再讓他決定。
 */
function ApproveDialog({
  order,
  project,
  onClose,
}: {
  order: ChangeOrder | null;
  project: ProjectDetail;
  onClose: () => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();

  const approve = useMutation({
    mutationFn: () =>
      api.post<{ message: string }>(`/change-orders/${order!.id}/approve`),
    onSuccess: (r) => {
      for (const k of ["change-orders", "project", "projects", "billing", "dashboard"]) {
        qc.invalidateQueries({ queryKey: [k] });
      }
      toast.success(`${order!.code} 已核准`, [r.message]);
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.body.detail : "核准失敗"),
  });

  const base = Number(project.effective_amount ?? 0);
  const delta = Number(order?.amount ?? 0);

  return (
    <Modal open={order !== null} onClose={onClose} title="核准變更追加單">
      {order && (
        <div>
          <p className="text-sm font-bold text-ink">{order.title}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-2">{order.reason}</p>

          <div className="mt-4 rounded-lg bg-page p-3">
            <p className="mb-1.5 text-xs font-semibold text-ink">核准後會發生什麼</p>
            <dl className="space-y-1 text-xs">
              <div className="flex justify-between">
                <dt className="text-ink-2">目前有效合約額</dt>
                <dd className="tabular-nums text-ink">{base.toLocaleString("zh-TW")}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-2">本次變更</dt>
                <dd
                  className="tabular-nums font-semibold"
                  style={{ color: delta < 0 ? "var(--color-delayed)" : "var(--color-ontrack)" }}
                >
                  {delta > 0 && "＋"}
                  {delta.toLocaleString("zh-TW")}
                </dd>
              </div>
              <div className="flex justify-between border-t border-line pt-1">
                <dt className="font-semibold text-ink">新的有效合約額</dt>
                <dd className="tabular-nums font-bold text-ink">
                  {(base + delta).toLocaleString("zh-TW")}
                </dd>
              </div>
            </dl>
          </div>

          <div
            className="mt-3 flex items-start gap-2 rounded-lg px-3 py-2.5"
            style={{ background: "var(--color-atrisk-bg)", color: "var(--color-atrisk)" }}
          >
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <p className="text-xs leading-relaxed">
              <strong>尚未請款的里程碑金額會自動重算</strong>（金額＝有效合約額 × 比例）。
              已經產生請款的里程碑<strong>不會被改動</strong>——送出去的數字不能被改掉。
              <br />
              核准後無法取消，只能再開一張反向的變更單。
            </p>
          </div>

          <div className="mt-4 flex gap-2">
            <Button onClick={onClose} className="flex-1">
              取消
            </Button>
            <Button
              variant="primary"
              onClick={() => approve.mutate()}
              loading={approve.isPending}
              className="flex-1"
            >
              <Check size={14} />
              確定核准
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
