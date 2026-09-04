/**
 * 構件批次站別維護（D54）
 *
 * 以前這件事只能在 Django Admin 做（`/admin/masters/stagetemplate/`）。
 * D54 把 Admin 整個移除，所以搬到這裡——鋼構批次要走幾站、每站叫什麼、
 * 什麼顏色、停多久算「卡住」，都在這一頁改。
 *
 * 刪不掉的站會說原因（有批次停著或有歷程），改停用即可——
 * 歷史紀錄指著它，刪了歷程就斷了。
 *
 * D55：順序可以**拖曳**（跟流程模板同一套手勢），編號即時跟著位置變。
 * 站的順序就是批次往前走的路線——改了之後，所有批次的下一站都照新順序。
 */
import { GripVertical, Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { ApiError } from "@/api/client";
import {
  useAddStage,
  useDeleteStage,
  useReorderStages,
  useSaveStage,
  useStageTemplates,
} from "@/api/hooks";
import type { Stage, StageTemplate } from "@/api/types";
import { Button, Card, EmptyState, SectionTitle, Spinner, inputClass } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";

export default function StageBoard() {
  const { data, isLoading } = useStageTemplates({ include_inactive: true });
  const toast = useToast();

  if (isLoading) return <Spinner />;
  const templates = data ?? [];
  if (!templates.length) return <EmptyState title="還沒有階段流程" />;

  return (
    <div className="space-y-4">
      <p className="rounded-xl bg-card px-3 py-2.5 text-xs leading-relaxed text-ink-2 ring-1 ring-line">
        構件批次沿著這些站往前走（追蹤看板的「構件批次」就是照這裡畫的）。
        改名稱、顏色或停滯天數會立刻套用到所有批次；
        <strong>停滯天數</strong>＝停在這一站超過幾天要列進「需要關注」，留空＝不檢查。
        拖曳左邊的握把（或 ↑↓）可以調整站的順序，編號即時跟著變。
      </p>
      {templates.map((t) => (
        <TemplateCard key={t.id} template={t} onError={(m) => toast.error(m)} />
      ))}
    </div>
  );
}

function TemplateCard({
  template,
  onError,
}: {
  template: StageTemplate;
  onError: (message: string) => void;
}) {
  const save = useSaveStage();
  const add = useAddStage();
  const remove = useDeleteStage();
  const reorder = useReorderStages();
  const toast = useToast();
  const [newName, setNewName] = useState("");
  // 拖曳中的暫時順序；放開才送出
  const [draft, setDraft] = useState<Stage[] | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);

  // 伺服器資料換了（改名、新增、刪除、重排成功）就丟掉本機草稿
  useEffect(() => setDraft(null), [template]);

  const stages = draft ?? template.stages;
  const active = stages.filter((s) => s.is_active);
  const inactive = stages.filter((s) => !s.is_active);

  const fail = (e: unknown) =>
    onError(e instanceof ApiError ? e.body.detail ?? "操作失敗" : "操作失敗");

  /** 把 fromId 移到 toId 的位置（只在啟用中的站之間；停用的不參與排序） */
  function move(fromId: number, toId: number) {
    if (fromId === toId) return;
    setDraft((prev) => {
      const list = [...(prev ?? template.stages)];
      const from = list.findIndex((s) => s.id === fromId);
      const to = list.findIndex((s) => s.id === toId);
      if (from < 0 || to < 0 || !list[from].is_active || !list[to].is_active) return prev;
      const [moved] = list.splice(from, 1);
      list.splice(to, 0, moved);
      return list;
    });
  }

  function commit(next?: Stage[]) {
    setDragId(null);
    const list = next ?? draft;
    if (!list) return;
    const ids = list.filter((s) => s.is_active).map((s) => s.id);
    const before = template.stages.filter((s) => s.is_active).map((s) => s.id);
    if (ids.join() === before.join()) {
      setDraft(null);
      return;
    }
    if (next) setDraft(next);
    reorder.mutate(
      { template: template.id, stage_ids: ids },
      {
        onSuccess: () => toast.success("站別順序已更新"),
        onError: (e) => {
          setDraft(null);   // 失敗就退回伺服器的順序
          fail(e);
        },
      },
    );
  }

  /** ↑↓：觸控裝置拖不動，留著這條路（只在啟用中的站之間換位） */
  function nudge(stage: Stage, dir: -1 | 1) {
    const list = [...stages];
    const i = list.findIndex((s) => s.id === stage.id);
    const order = active.map((s) => s.id);
    const j = order.indexOf(stage.id) + dir;
    if (j < 0 || j >= order.length) return;
    const k = list.findIndex((s) => s.id === order[j]);
    [list[i], list[k]] = [list[k], list[i]];
    commit(list);
  }

  return (
    <Card className="p-3">
      <SectionTitle>
        {template.name}
        <span className="ml-1.5 text-xs font-normal text-ink-3">
          {active.length} 站
          {inactive.length > 0 && `（另有 ${inactive.length} 站已停用）`}
        </span>
      </SectionTitle>

      <ul className="space-y-2">
        {stages.map((s) => (
          <li
            key={s.id}
            draggable={dragId === s.id}
            onDragStart={(e) => {
              setDragId(s.id);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (dragId !== null) move(dragId, s.id);
            }}
            onDragEnd={() => commit()}
            onDrop={(e) => e.preventDefault()}
            onMouseUp={() => setDragId(null)}
            className={[
              "flex flex-wrap items-center gap-2 rounded-lg",
              dragId === s.id ? "ring-1 ring-stage-2" : "",
            ].join(" ")}
          >
            {/* 只有按住握把才拖得動——不然在名稱欄選字會變成拖整列 */}
            <span
              onMouseDown={() => s.is_active && setDragId(s.id)}
              onTouchStart={() => s.is_active && setDragId(s.id)}
              aria-label={`拖曳 ${s.name} 調整順序`}
              className={[
                "shrink-0 touch-none p-0.5",
                s.is_active ? "cursor-grab text-ink-3 active:cursor-grabbing" : "opacity-0",
              ].join(" ")}
            >
              <GripVertical size={14} aria-hidden />
            </span>
            {/* 停用的站不佔序號——批次實際走的是啟用中的那幾站 */}
            <span
              className="w-9 shrink-0 text-center text-xs font-bold tabular-nums"
              style={{ color: s.is_active ? "var(--color-ink-3)" : "var(--color-delayed)" }}
            >
              {s.is_active ? active.findIndex((x) => x.id === s.id) + 1 : "停用"}
            </span>
            <input
              type="color"
              value={s.color}
              onChange={(e) =>
                save.mutate(
                  { template: template.id, stage: s.id, color: e.target.value },
                  { onError: fail },
                )
              }
              aria-label={`${s.name} 的顏色`}
              className="h-9 w-9 shrink-0 cursor-pointer rounded-lg border border-line bg-card p-0.5"
            />
            <input
              defaultValue={s.name}
              onBlur={(e) => {
                const name = e.target.value.trim();
                if (name && name !== s.name) {
                  save.mutate({ template: template.id, stage: s.id, name }, { onError: fail });
                }
              }}
              aria-label={`${s.name} 的站別名稱`}
              className={`${inputClass} min-w-32 flex-1`}
              style={{ opacity: s.is_active ? 1 : 0.5 }}
            />
            <label className="flex shrink-0 items-center gap-1 text-xs text-ink-2">
              停滯
              <input
                type="number"
                min={1}
                defaultValue={s.stall_days ?? ""}
                placeholder="不檢查"
                onBlur={(e) => {
                  const raw = e.target.value.trim();
                  const value = raw ? Number(raw) : null;
                  if (value !== (s.stall_days ?? null)) {
                    save.mutate(
                      { template: template.id, stage: s.id, stall_days: value },
                      { onError: fail },
                    );
                  }
                }}
                className={`${inputClass} w-20`}
              />
              天
            </label>
            {s.is_active && (
              <span className="flex shrink-0 items-center">
                <button
                  type="button"
                  onClick={() => nudge(s, -1)}
                  aria-label={`${s.name} 上移`}
                  className="rounded px-1 py-1 text-xs text-ink-3 hover:bg-page"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => nudge(s, 1)}
                  aria-label={`${s.name} 下移`}
                  className="rounded px-1 py-1 text-xs text-ink-3 hover:bg-page"
                >
                  ↓
                </button>
              </span>
            )}
            <button
              type="button"
              onClick={() =>
                save.mutate(
                  { template: template.id, stage: s.id, is_active: !s.is_active },
                  { onError: fail },
                )
              }
              className="shrink-0 rounded-lg border border-line px-2.5 py-2 text-xs font-semibold text-ink-2 transition-base hover:bg-page"
            >
              {s.is_active ? "停用" : "啟用"}
            </button>
            <button
              type="button"
              onClick={() =>
                remove.mutate(
                  { template: template.id, stage: s.id },
                  {
                    onSuccess: () => toast.success(`已刪除「${s.name}」`),
                    onError: fail,
                  },
                )
              }
              aria-label={`刪除 ${s.name}`}
              className="shrink-0 rounded-lg p-2 text-ink-3 transition-base hover:bg-page"
            >
              <Trash2 size={15} />
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex gap-2 border-t border-line pt-3">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newName.trim()) {
              add.mutate(
                { template: template.id, name: newName.trim() },
                {
                  onSuccess: () => {
                    setNewName("");
                    toast.success("已新增一站（排在最後）");
                  },
                  onError: fail,
                },
              );
            }
          }}
          placeholder="在最後面加一站，如「鍍鋅回廠」"
          className={`${inputClass} flex-1`}
        />
        <Button
          variant="primary"
          onClick={() =>
            newName.trim() &&
            add.mutate(
              { template: template.id, name: newName.trim() },
              {
                onSuccess: () => {
                  setNewName("");
                  toast.success("已新增一站（排在最後）");
                },
                onError: fail,
              },
            )
          }
          loading={add.isPending}
        >
          {add.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          新增站別
        </Button>
      </div>
    </Card>
  );
}
