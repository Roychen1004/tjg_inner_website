/**
 * 流程編排器（D49）——建案表單與「編輯流程」共用
 *
 * Notion 式的清單：勾選要走哪些、**拖曳（或 ↑↓）調整順序**、
 * 每個階段可以「＋新增」目錄上沒有的自訂流程。
 * 五大階段的骨架不動——流程只能在自己的階段裡移動。
 *
 * D37 的「順序全域定死」由老闆翻案（D49）：順序現在是每個案子自己的。
 */
import { GripVertical, Plus, X } from "lucide-react";
import { useRef, useState } from "react";

import type { FlowCatalogStage, FlowUnit } from "@/api/types";

export interface FlowEntry {
  /** 穩定 key："item-<目錄id>"｜"unit-<單元id>"｜"new-<流水>" */
  key: string;
  /** 目錄工作項 id；自訂流程為 null */
  itemId: number | null;
  /** 既有單元 id（編輯模式）；建案時為 null */
  unitId: number | null;
  name: string;
  code: string;
  stageSeq: number;
  included: boolean;
  isCustom: boolean;
  isGate: boolean;
  batchRollup: boolean;
}

let newSerial = 0;

/** 依目錄建立起始清單（建案：預設全勾） */
export function entriesFromCatalog(stages: FlowCatalogStage[]): FlowEntry[] {
  return stages.flatMap((stage) =>
    stage.items.map((item) => ({
      key: `item-${item.id}`,
      itemId: item.id,
      unitId: null,
      name: item.name,
      code: item.code,
      stageSeq: stage.seq,
      included: true,
      isCustom: false,
      isGate: item.is_gate,
      batchRollup: item.batch_stage_seq !== null,
    })),
  );
}

/** 依既有專案建立清單（編輯：目前的單元照 seq 排＋目錄裡還沒勾的） */
export function entriesFromProject(
  stages: FlowCatalogStage[],
  units: FlowUnit[],
): FlowEntry[] {
  const active = units
    .filter((u) => u.state !== "na")
    .sort((a, b) => a.seq - b.seq || a.id - b.id);
  const usedItems = new Set(
    units.filter((u) => u.flow_item !== null).map((u) => u.flow_item as number),
  );
  const naItems = new Set(
    units
      .filter((u) => u.state === "na" && u.flow_item !== null)
      .map((u) => u.flow_item as number),
  );

  const entries: FlowEntry[] = active.map((u) => ({
    key: `unit-${u.id}`,
    itemId: u.flow_item,
    unitId: u.id,
    name: u.flow_name,
    code: u.flow_code,
    stageSeq: u.stage_seq,
    included: true,
    isCustom: u.flow_item === null,
    isGate: u.is_gate,
    batchRollup: false,
  }));

  // 目錄裡這個案子還沒勾的（含被標不適用的）——顯示成未勾，勾回來＝加勾／還原
  for (const stage of stages) {
    for (const item of stage.items) {
      if (usedItems.has(item.id) && !naItems.has(item.id)) continue;
      entries.push({
        key: `item-${item.id}`,
        itemId: item.id,
        unitId: units.find((u) => u.flow_item === item.id)?.id ?? null,
        name: item.name,
        code: item.code,
        stageSeq: stage.seq,
        included: false,
        isCustom: false,
        isGate: item.is_gate,
        batchRollup: item.batch_stage_seq !== null,
      });
    }
  }
  return entries;
}

export default function FlowArranger({
  stages,
  entries,
  onChange,
}: {
  stages: FlowCatalogStage[];
  entries: FlowEntry[];
  onChange: (next: FlowEntry[]) => void;
}) {
  const dragKey = useRef<string | null>(null);
  const [draft, setDraft] = useState<Record<number, string>>({});

  function update(mutate: (list: FlowEntry[]) => FlowEntry[]) {
    onChange(mutate([...entries]));
  }

  function toggle(key: string) {
    update((list) =>
      list.map((e) => (e.key === key ? { ...e, included: !e.included } : e)),
    );
  }

  function removeNew(key: string) {
    update((list) => list.filter((e) => e.key !== key));
  }

  function addCustom(stageSeq: number) {
    const name = (draft[stageSeq] ?? "").trim();
    if (!name) return;
    setDraft((d) => ({ ...d, [stageSeq]: "" }));
    newSerial += 1;
    update((list) => {
      // 插在該階段最後一列的後面
      let insertAt = list.length;
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].stageSeq === stageSeq) {
          insertAt = i + 1;
          break;
        }
      }
      const entry: FlowEntry = {
        key: `new-${newSerial}`,
        itemId: null,
        unitId: null,
        name,
        code: "自訂",
        stageSeq,
        included: true,
        isCustom: true,
        isGate: false,
        batchRollup: false,
      };
      return [...list.slice(0, insertAt), entry, ...list.slice(insertAt)];
    });
  }

  /** 把 fromKey 移到 toKey 的位置（同階段內） */
  function moveTo(fromKey: string, toKey: string) {
    if (fromKey === toKey) return;
    update((list) => {
      const from = list.findIndex((e) => e.key === fromKey);
      const to = list.findIndex((e) => e.key === toKey);
      if (from < 0 || to < 0 || list[from].stageSeq !== list[to].stageSeq) return list;
      const next = [...list];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  function nudge(key: string, dir: -1 | 1) {
    update((list) => {
      const i = list.findIndex((e) => e.key === key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length || list[j].stageSeq !== list[i].stageSeq)
        return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  return (
    <div className="space-y-2">
      {stages.map((stage) => {
        const rows = entries.filter((e) => e.stageSeq === stage.seq);
        const picked = rows.filter((e) => e.included).length;
        // D51：編號是**位置**不是身分——依目前順序即時編（3.4 拖上去就變 3.3）；
        // 沒勾的不佔號，顯示「－」
        const codeOf = new Map<string, string>();
        let n = 0;
        for (const e of rows) {
          if (e.included) {
            n += 1;
            codeOf.set(e.key, `${stage.seq}.${n}`);
          }
        }
        return (
          <section key={stage.seq} className="rounded-xl bg-page p-2.5">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-bold text-ink">
                第{stage.seq}階段　{stage.name}
              </span>
              <span className="ml-auto text-xs tabular-nums text-ink-3">
                {picked}/{rows.length}
              </span>
            </div>
            <ul className="mt-1.5 space-y-0.5">
              {rows.map((entry) => (
                <li
                  key={entry.key}
                  draggable
                  onDragStart={(e) => {
                    dragKey.current = entry.key;
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (dragKey.current) moveTo(dragKey.current, entry.key);
                  }}
                  onDragEnd={() => {
                    dragKey.current = null;
                  }}
                  className={[
                    "flex items-center gap-1.5 rounded-md bg-card px-1.5 py-1 ring-1 ring-line",
                    entry.included ? "" : "opacity-55",
                  ].join(" ")}
                >
                  <GripVertical size={13} className="shrink-0 cursor-grab text-ink-3" aria-hidden />
                  <input
                    type="checkbox"
                    checked={entry.included}
                    onChange={() => toggle(entry.key)}
                    aria-label={`勾選 ${entry.name}`}
                    className="h-4 w-4 shrink-0 accent-[var(--color-stage-2)]"
                  />
                  <span className="min-w-0 flex-1 truncate text-xs leading-snug text-ink">
                    <span className="mr-1 font-semibold tabular-nums text-ink-3">
                      {codeOf.get(entry.key) ?? "－"}
                    </span>
                    {entry.name}
                    {entry.isGate && (
                      <span className="ml-1.5 rounded bg-page px-1 py-px text-[11px] font-semibold text-ink-2">
                        關卡
                      </span>
                    )}
                    {entry.batchRollup && (
                      <span className="ml-1.5 text-[11px] text-ink-3">批次自動彙總</span>
                    )}
                    {entry.isCustom && (
                      <span className="ml-1.5 rounded bg-page px-1 py-px text-[11px] font-semibold text-ink-2">
                        自訂
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center">
                    <button
                      type="button"
                      onClick={() => nudge(entry.key, -1)}
                      aria-label={`${entry.name} 上移`}
                      className="rounded px-1 py-0.5 text-xs text-ink-3 hover:bg-page"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => nudge(entry.key, 1)}
                      aria-label={`${entry.name} 下移`}
                      className="rounded px-1 py-0.5 text-xs text-ink-3 hover:bg-page"
                    >
                      ↓
                    </button>
                    {entry.isCustom && entry.unitId === null && (
                      <button
                        type="button"
                        onClick={() => removeNew(entry.key)}
                        aria-label={`移除 ${entry.name}`}
                        className="rounded p-0.5 text-ink-3 hover:text-[var(--color-delayed)]"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {/* 自訂流程：目錄上沒有、這個案子需要的一步 */}
            <div className="mt-1.5 flex items-center gap-1.5">
              <input
                value={draft[stage.seq] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [stage.seq]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCustom(stage.seq);
                  }
                }}
                placeholder="＋自訂流程（如：拆除舊棚架）"
                aria-label={`第${stage.seq}階段新增自訂流程`}
                className="min-w-0 flex-1 rounded-md border border-line bg-card px-2 py-1 text-xs text-ink"
              />
              <button
                type="button"
                onClick={() => addCustom(stage.seq)}
                disabled={!(draft[stage.seq] ?? "").trim()}
                className="flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-1 text-xs font-semibold text-ink-2 ring-1 ring-line hover:bg-card disabled:opacity-40"
              >
                <Plus size={11} />
                新增
              </button>
            </div>
          </section>
        );
      })}
      <p className="text-xs leading-relaxed text-ink-3">
        拖曳（或 ↑↓）調整順序、勾選決定要不要走；每個階段最下面可以加目錄上沒有的自訂流程。
        順序是**這個案子自己的**，不影響其他案子與目錄。
      </p>
    </div>
  );
}
