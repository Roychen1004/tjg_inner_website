/**
 * 行政事項卡片（D53）
 *
 * 點日曆或清單上的事項就開這張——**完成回報在這裡做，不是在格子上打勾**。
 * 打勾太容易誤觸，而且繳費、清掃這種事常要留憑證（收據、照片），
 * 所以完成動作跟檔案區放在同一張卡：看內容 → 傳照片／收據 → 按完成。
 *
 * 誰能按完成：被指派的人本人，或經理／系統管理員（代打）。
 * 沒被指派又沒權限的人只能看（含看檔案）。
 */
import { Check, Pencil, RotateCcw, Repeat, Undo2 } from "lucide-react";

import { ApiError } from "@/api/client";
import { useCompleteAffairTask } from "@/api/hooks";
import { useCurrentUser } from "@/api/hooks/useAuth";
import type { AffairTask } from "@/api/types";
import AttachmentSection from "@/components/attachments/AttachmentSection";
import { Button, Modal, Money } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";

export default function AffairTaskCard({
  task,
  open,
  onClose,
  onEdit,
}: {
  task: AffairTask;
  open: boolean;
  onClose: () => void;
  /** 經理才有：改這一筆的內容 */
  onEdit?: () => void;
}) {
  const { data: user } = useCurrentUser();
  const complete = useCompleteAffairTask();
  const toast = useToast();

  const canEdit = Boolean(user?.permissions.edit_affairs);
  const isAssignee = Boolean(user && task.assignees.includes(user.id));
  const canComplete = canEdit || isAssignee;

  function toggle(done: boolean) {
    complete.mutate(
      { id: task.id, done },
      {
        onSuccess: (saved) => {
          if (saved.is_done) {
            toast.success(`已完成：${saved.title}`, ["經理會收到完成通知"]);
            onClose();
          } else {
            toast.success(`已改回未完成：${saved.title}`);
          }
        },
        onError: (e) =>
          toast.error(e instanceof ApiError ? e.body.detail ?? "操作失敗" : "操作失敗"),
      },
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={task.title}
      footer={
        <>
          {canEdit && onEdit && (
            <Button variant="ghost" onClick={onEdit}>
              <Pencil size={14} />
              修改內容
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} className="ml-auto">
            關閉
          </Button>
          {canComplete &&
            (task.is_done ? (
              <Button variant="ghost" onClick={() => toggle(false)} loading={complete.isPending}>
                <Undo2 size={14} />
                改回未完成
              </Button>
            ) : (
              <Button variant="primary" onClick={() => toggle(true)} loading={complete.isPending}>
                <Check size={14} />
                回報完成
              </Button>
            ))}
        </>
      }
    >
      {/* 這件事的基本資料 */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span
          className="rounded-full px-2 py-0.5 text-xs font-semibold"
          style={{ background: `${task.category_color}1a`, color: task.category_color }}
        >
          {task.category_name}
        </span>
        <span className="text-sm font-semibold tabular-nums text-ink">{task.date}</span>
        {task.rule_text && (
          <span className="inline-flex items-center gap-0.5 text-xs text-ink-3">
            <Repeat size={12} />
            {task.rule_text}
          </span>
        )}
        {task.is_overdue && (
          <span className="text-xs font-bold" style={{ color: "var(--color-delayed)" }}>
            逾期未做
          </span>
        )}
        {/* D55：有金額的話就是公司的一筆錢，會出現在金流 → 收支明細
            D56：標成「參考」的是預估，用灰字寫明白，免得被當成真的要收付 */}
        {Number(task.amount) > 0 && (
          <span
            className="ml-auto text-sm font-bold tabular-nums"
            style={{
              color: task.is_reference
                ? "var(--color-ink-3)"
                : task.direction === "in"
                  ? "var(--color-ontrack)"
                  : "var(--color-delayed)",
            }}
          >
            {task.is_reference
              ? `參考（預計${task.direction_label}）`
              : task.direction === "in" ? "收 +" : "付 −"}
            <Money value={task.amount} />
            <span className="ml-0.5 text-xs font-normal text-ink-3">元</span>
          </span>
        )}
      </div>

      <dl className="mb-3 space-y-1.5 text-sm">
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 text-ink-3">負責人</dt>
          <dd className="text-ink">
            {task.assignee_names.length ? task.assignee_names.join("、") : "未指派"}
            {task.assignee_names.length > 1 && (
              <span className="ml-1 text-xs text-ink-3">（任一人回報完成即整件完成）</span>
            )}
          </dd>
        </div>
        {Number(task.amount) > 0 && (
          <div className="flex gap-2">
            <dt className="w-16 shrink-0 text-ink-3">金流</dt>
            <dd className="text-xs text-ink-2">
              {task.is_reference ? (
                <>
                  這是<b>參考金額</b>（預估會{task.direction_label}多少），
                  <b>不會</b>算進「金流」的收入與支出。談定了就把金額那排改成
                  {task.direction_label}，它才會進帳
                </>
              ) : (
                <>
                  這筆{task.direction_label}會出現在「金流 → 收支明細」與現金流預測
                  {task.is_done ? "（已完成＝錢已經進出了）" : "（還沒完成＝預計）"}
                </>
              )}
            </dd>
          </div>
        )}
        {task.note && (
          <div className="flex gap-2">
            <dt className="w-16 shrink-0 text-ink-3">備註</dt>
            <dd className="whitespace-pre-line text-ink-2">{task.note}</dd>
          </div>
        )}
        {task.is_done && (
          <div className="flex gap-2">
            <dt className="w-16 shrink-0 text-ink-3">完成</dt>
            <dd className="font-semibold" style={{ color: "var(--color-ontrack)" }}>
              {task.done_by_name ?? "—"}
              {task.done_at && (
                <span className="ml-1 font-normal text-ink-3">
                  {new Date(task.done_at).toLocaleString("zh-TW")}
                </span>
              )}
            </dd>
          </div>
        )}
      </dl>

      {/* 憑證：繳費收據、打掃前後照片、申報回執…… */}
      <AttachmentSection
        target="affair-task"
        id={task.id}
        title="相關檔案（收據、照片、文件）"
        defaultCategory="other"
        compact
      />

      {!canComplete && (
        <p className="mt-3 text-xs text-ink-3">
          <RotateCcw size={11} className="mr-1 inline" />
          這件事沒有指派給你，所以只能看。要回報完成請找經理。
        </p>
      )}
    </Modal>
  );
}
