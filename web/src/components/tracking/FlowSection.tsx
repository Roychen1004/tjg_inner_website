/**
 * 專案明細的流程排程表
 *
 * 回答的問題：這個案子勾了哪些流程、每一步排給誰、排到什麼時候。
 * 依五大階段分組、目錄順序排列。點一列開單元明細（指派、排期、回報都在那裡）。
 */
import { ChevronRight, FileSpreadsheet, ListChecks } from "lucide-react";
import { useState } from "react";

import { API_BASE, ApiError } from "@/api/client";
import {
  useAddCustomFlow,
  useDeleteFlowUnit,
  useFlowCatalog,
  useReorderFlows,
  useSetFlows,
} from "@/api/hooks";
import { useCurrentUser } from "@/api/hooks/useAuth";
import type { FlowUnit, ProjectDetail } from "@/api/types";
import FlowStateBadge from "@/components/tracking/FlowStateBadge";
import { useUnitPanel } from "@/components/tracking/UnitPanelContext";
import FlowArranger, { entriesFromProject, type FlowEntry } from "@/components/forms/FlowArranger";
import { Button, EmptyState, Modal, SectionTitle } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";

export default function FlowSection({ detail }: { detail: ProjectDetail }) {
  const { data: user } = useCurrentUser();
  const { open: openUnitPanel } = useUnitPanel();
  const [editingFlows, setEditingFlows] = useState(false);

  const units = detail.flow_units;
  const active = units.filter((u) => u.state !== "na");
  const groups = groupByStage(active);

  return (
    <div className="mt-4">
      <SectionTitle
        action={
          <span className="flex items-center gap-1">
            {active.length > 0 && (
              // 內部版甘特 Excel（含負責人/狀態/進度）。給業主的「工期規劃」在收合卡片上。
              // 走瀏覽器原生下載（同網域帶 session cookie），不用 fetch
              <a
                href={`${API_BASE}/projects/${detail.id}/gantt-xlsx?variant=progress`}
                download
                title="內部用：含負責人、狀態、進度與圖例"
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-ink-2 transition-base hover:bg-page"
              >
                <FileSpreadsheet size={13} />
                下載進度追蹤
              </a>
            )}
            {detail.can_edit && (
              <Button variant="ghost" onClick={() => setEditingFlows(true)}>
                <ListChecks size={13} />
                編輯流程
              </Button>
            )}
          </span>
        }
      >
        流程排程表
        <span className="ml-1.5 text-xs font-normal text-ink-3">
          {active.filter((u) => u.state === "done").length}/{active.length} 完成
        </span>
      </SectionTitle>

      {active.length === 0 ? (
        <EmptyState
          title="這個案子還沒勾選流程"
          hint="點「編輯流程」把這個案子要走的步驟勾起來，每一步就會出現在這裡與追蹤看板"
          action={
            detail.can_edit ? (
              <Button variant="primary" onClick={() => setEditingFlows(true)}>
                <ListChecks size={14} />
                勾選流程
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-2.5">
          {groups.map((group) => (
            <section key={group.seq} className="overflow-hidden rounded-xl bg-card ring-1 ring-line">
              <header className="flex items-baseline gap-2 border-b border-line bg-page/60 px-3 py-1.5">
                <h3 className="text-xs font-bold text-ink">
                  第{group.seq}階段　{group.name}
                </h3>
                <span className="ml-auto text-xs tabular-nums text-ink-3">
                  {group.units.filter((u) => u.state === "done").length}/{group.units.length}
                </span>
              </header>
              <ul className="divide-y divide-line">
                {group.units.map((unit) => (
                  <li key={unit.id}>
                    <button
                      type="button"
                      onClick={() => openUnitPanel(unit.id)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left transition-base hover:bg-page"
                    >
                      <span className="w-8 shrink-0 text-xs font-semibold tabular-nums text-ink-3">
                        {unit.flow_code}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold text-ink">
                          {unit.flow_name}
                        </span>
                        <span className="block truncate text-xs text-ink-3">
                          {unit.assignee_name ? (
                            unit.assignee_name
                          ) : unit.state === "doing" ? (
                            <span style={{ color: "var(--color-atrisk)" }}>未指派負責人</span>
                          ) : (
                            "未指派"
                          )}
                          {unit.plan_end && (
                            <span
                              className="ml-2"
                              style={unit.is_overdue ? { color: "var(--color-delayed)" } : undefined}
                            >
                              {unit.plan_start ?? "？"} ~ {unit.plan_end}
                            </span>
                          )}
                        </span>
                      </span>
                      {unit.qty_total !== null && Number(unit.qty_total) > 0 ? (
                        <span className="shrink-0 text-xs tabular-nums text-ink-2">
                          {Number(unit.qty_done)}/{Number(unit.qty_total)} {unit.unit_of_measure}
                        </span>
                      ) : unit.state === "doing" && Number(unit.progress_pct ?? 0) > 0 ? (
                        <span className="shrink-0 text-xs tabular-nums text-ink-2">
                          {Number(unit.progress_pct)}%
                        </span>
                      ) : null}
                      <FlowStateBadge state={unit.state} overdue={unit.is_overdue} />
                      <ChevronRight size={14} className="shrink-0 text-ink-3" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {units.some((u) => u.state === "na") && (
        <p className="mt-1.5 text-xs text-ink-3">
          另有 {units.filter((u) => u.state === "na").length} 項標為「不適用」
          {user?.permissions.edit_project ? "——在「編輯流程」勾回來可還原" : ""}。
        </p>
      )}

      {editingFlows && (
        <FlowEditorModal detail={detail} onClose={() => setEditingFlows(false)} />
      )}
    </div>
  );
}

function groupByStage(units: FlowUnit[]) {
  const map = new Map<number, { seq: number; name: string; units: FlowUnit[] }>();
  for (const unit of units) {
    const g = map.get(unit.stage_seq) ?? { seq: unit.stage_seq, name: unit.stage_name, units: [] };
    g.units.push(unit);
    map.set(unit.stage_seq, g);
  }
  return [...map.values()].sort((a, b) => a.seq - b.seq);
}

/**
 * 編輯流程（D49 改版）：Notion 式編排——勾選、拖曳排序、加自訂流程。
 * 儲存時依序：set-flows（勾選增減）→ add-flow（新自訂）→
 * 刪掉被取消的自訂 → reorder-flows（最終順序）。
 */
function FlowEditorModal({ detail, onClose }: { detail: ProjectDetail; onClose: () => void }) {
  const { data: stages } = useFlowCatalog();
  const setFlows = useSetFlows(detail.id);
  const addCustom = useAddCustomFlow(detail.id);
  const reorder = useReorderFlows(detail.id);
  const deleteUnit = useDeleteFlowUnit();
  const toast = useToast();
  const [entries, setEntries] = useState<FlowEntry[] | null>(null);
  const [saving, setSaving] = useState(false);

  // 目錄載入後建一次起始清單（既有單元照 seq 排＋還沒勾的目錄項）
  if (stages && entries === null) {
    setEntries(entriesFromProject(stages, detail.flow_units));
  }

  const included = (entries ?? []).filter((e) => e.included);

  async function submit() {
    if (!stages || !entries) return;
    const stageIdBySeq = new Map(stages.map((s) => [s.seq, s.id]));
    setSaving(true);
    try {
      // ① 勾選增減（只管目錄項；自訂流程不歸它管）
      const itemIds = included.filter((e) => e.itemId !== null).map((e) => e.itemId as number);
      const result = await setFlows.mutateAsync(itemIds);
      const unitByItem = new Map(
        result.project.flow_units
          .filter((u) => u.flow_item !== null)
          .map((u) => [u.flow_item as number, u.id]),
      );

      // ② 新自訂流程
      const createdByKey = new Map<string, number>();
      for (const e of entries) {
        if (e.isCustom && e.unitId === null && e.included) {
          const stageId = stageIdBySeq.get(e.stageSeq);
          if (!stageId) continue;
          const unit = await addCustom.mutateAsync({ name: e.name, stage: stageId });
          createdByKey.set(e.key, unit.id);
        }
      }

      // ③ 被取消勾選的自訂流程 → 刪除（做過的後端會擋，改標不適用要在卡片上做）
      for (const e of entries) {
        if (e.isCustom && e.unitId !== null && !e.included) {
          await deleteUnit.mutateAsync(e.unitId);
        }
      }

      // ④ 最終順序
      const orderedIds = included
        .map((e) =>
          e.unitId !== null
            ? e.unitId
            : e.itemId !== null
              ? unitByItem.get(e.itemId) ?? null
              : createdByKey.get(e.key) ?? null,
        )
        .filter((id): id is number => id !== null);
      await reorder.mutateAsync(orderedIds);

      const lines = [
        result.added.length ? `加勾：${result.added.join("、")}` : "",
        result.removed.length ? `移除：${result.removed.join("、")}` : "",
        result.marked_na.length ? `標不適用（已有紀錄）：${result.marked_na.join("、")}` : "",
        result.restored.length ? `還原：${result.restored.join("、")}` : "",
        createdByKey.size ? `新增自訂：${createdByKey.size} 項` : "",
      ].filter(Boolean);
      toast.success("流程已更新", lines.length ? lines : ["順序已更新"]);
      onClose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.body.detail ?? "儲存失敗" : "儲存失敗");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`編輯流程：${detail.name}`}
      footer={
        <>
          <Button onClick={onClose} className="flex-1">
            取消
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            loading={saving}
            disabled={included.length === 0}
            className="flex-1"
          >
            儲存（{included.length} 項）
          </Button>
        </>
      }
    >
      <p className="mb-3 text-xs leading-relaxed text-ink-3">
        取消勾選時：還沒開始且沒有紀錄的直接移除；已經有進度或附件的改標「不適用」，歷史會留著。
      </p>
      {stages && entries && (
        <FlowArranger stages={stages} entries={entries} onChange={setEntries} />
      )}
    </Modal>
  );
}
