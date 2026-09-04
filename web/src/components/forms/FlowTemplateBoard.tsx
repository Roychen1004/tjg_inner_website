/**
 * 流程模板維護（設定 → 流程模板，D49）
 *
 * 回答的問題：**新案的起手流程長什麼樣**。
 * 只有經理與系統管理員看得到這個分頁；改的是「之後新建案子的預設」，
 * 已建案子的流程早就抄走了，不會被回頭改動。
 *
 * 能做的事：新增／複製／改名／停用模板、設定預設模板；
 * 模板內：加工作項、改名稱與預設的工作內容三欄、調順序、刪（用過的只能停用）。
 *
 * D55：順序改成**拖曳**（跟案子裡的流程編排同一套手勢），編號即時跟著位置變——
 * 3.4 拖到前面，畫面上馬上變 3.3，放開才送出。↑↓ 留著給觸控裝置。
 */
import { Check, ChevronDown, Copy, GripVertical, Plus, Star, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ApiError } from "@/api/client";
import {
  useDeleteFlowItem,
  useDeleteFlowTemplate,
  useDuplicateFlowTemplate,
  useFlowCatalog,
  useFlowTemplates,
  useReorderFlowTemplate,
  useSaveFlowItem,
  useSaveFlowTemplate,
} from "@/api/hooks";
import type { FlowCatalogItem, FlowCatalogStage } from "@/api/types";
import { Button, Spinner, inputClass } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";

export default function FlowTemplateBoard() {
  const { data: templates } = useFlowTemplates();
  const saveTemplate = useSaveFlowTemplate();
  const duplicate = useDuplicateFlowTemplate();
  const removeTemplate = useDeleteFlowTemplate();
  const toast = useToast();
  const [selected, setSelected] = useState<number | null>(null);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);

  const current =
    templates?.find((t) => t.id === selected) ??
    templates?.find((t) => t.is_default) ??
    templates?.[0];

  function err(e: unknown, fallback: string) {
    toast.error(e instanceof ApiError ? e.body.detail ?? fallback : fallback);
  }

  if (!templates) return <Spinner />;

  return (
    <div>
      {/* 模板清單 */}
      <div className="flex flex-wrap items-center gap-1.5">
        {templates.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setSelected(t.id);
              setRenaming(null);
            }}
            className={[
              "flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-base",
              current?.id === t.id
                ? "bg-stage-2 text-white"
                : "bg-page text-ink-2 ring-1 ring-line hover:bg-card",
            ].join(" ")}
          >
            {t.is_default && <Star size={11} aria-label="預設模板" />}
            {t.name}
            <span className="font-normal opacity-75">{t.item_count}</span>
          </button>
        ))}
        <span className="ml-auto flex items-center gap-1.5">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="新模板名稱（如：小型土建案）"
            aria-label="新模板名稱"
            className="w-44 rounded-lg border border-line bg-card px-2 py-1.5 text-xs text-ink"
          />
          <Button
            onClick={() => {
              const name = newName.trim();
              if (!name) return;
              saveTemplate.mutate(
                { name },
                {
                  onSuccess: (t) => {
                    setNewName("");
                    setSelected(t.id);
                    toast.success(`已建立模板「${t.name}」`, ["空的——在下面加工作項，或用「複製」從既有模板改起"]);
                  },
                  onError: (e) => err(e, "建立失敗"),
                },
              );
            }}
            variant="primary"
            loading={saveTemplate.isPending}
            disabled={!newName.trim()}
          >
            <Plus size={13} />
            新增模板
          </Button>
        </span>
      </div>

      {current && (
        <div className="mt-3">
          {/* 目前模板的操作列 */}
          <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-card p-2 ring-1 ring-line">
            {renaming !== null ? (
              <>
                <input
                  value={renaming}
                  onChange={(e) => setRenaming(e.target.value)}
                  aria-label="模板新名稱"
                  className="w-44 rounded-lg border border-line bg-page px-2 py-1 text-xs text-ink"
                  autoFocus
                />
                <Button
                  onClick={() =>
                    saveTemplate.mutate(
                      { id: current.id, name: renaming.trim() },
                      {
                        onSuccess: () => {
                          setRenaming(null);
                          toast.success("已改名");
                        },
                        onError: (e) => err(e, "改名失敗"),
                      },
                    )
                  }
                  disabled={!renaming.trim()}
                >
                  <Check size={13} />
                  確定
                </Button>
                <Button onClick={() => setRenaming(null)}>取消</Button>
              </>
            ) : (
              <>
                <span className="text-sm font-bold text-ink">{current.name}</span>
                <button
                  type="button"
                  onClick={() => setRenaming(current.name)}
                  className="rounded px-1.5 py-0.5 text-xs font-semibold text-ink-2 hover:bg-page"
                >
                  改名
                </button>
              </>
            )}
            {!current.is_default && (
              <button
                type="button"
                onClick={() =>
                  saveTemplate.mutate(
                    { id: current.id, is_default: true },
                    {
                      onSuccess: () => toast.success(`「${current.name}」已設為預設——建案表單會預先選它`),
                      onError: (e) => err(e, "設定失敗"),
                    },
                  )
                }
                className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-semibold text-ink-2 hover:bg-page"
              >
                <Star size={11} />
                設為預設
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                duplicate.mutate(
                  { id: current.id },
                  {
                    onSuccess: (t) => {
                      setSelected(t.id);
                      toast.success(`已複製為「${t.name}」`, ["直接在複製出來的這套上增刪修改"]);
                    },
                    onError: (e) => err(e, "複製失敗"),
                  },
                )
              }
              className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-semibold text-ink-2 hover:bg-page"
            >
              <Copy size={11} />
              複製
            </button>
            {!current.is_default && (
              <button
                type="button"
                onClick={() => {
                  if (!window.confirm(`刪除模板「${current.name}」？（有案子用過會擋下來）`)) return;
                  removeTemplate.mutate(current.id, {
                    onSuccess: () => {
                      setSelected(null);
                      toast.success("已刪除");
                    },
                    onError: (e) => err(e, "刪除失敗"),
                  });
                }}
                className="ml-auto flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-semibold text-ink-3 hover:text-[var(--color-delayed)]"
              >
                <Trash2 size={11} />
                刪除
              </button>
            )}
          </div>

          <TemplateItems templateId={current.id} />

          <p className="mt-2 text-xs leading-relaxed text-ink-3">
            這裡改的是**之後新建案子**的預設流程與工作內容；已建的案子不受影響
            （每個案子在建案時就把內容抄走了，之後在案子的流程卡片上各自改）。
          </p>
        </div>
      )}
    </div>
  );
}

/** 模板內容：五大階段 × 工作項（加、改、刪、拖曳調順序） */
function TemplateItems({ templateId }: { templateId: number }) {
  const { data: catalog } = useFlowCatalog(true, templateId);
  const reorder = useReorderFlowTemplate();
  const toast = useToast();
  // 拖曳中的暫時順序。放開才送出——每移動一格就打一次 API 太吵
  const [draft, setDraft] = useState<FlowCatalogStage[] | null>(null);
  const dragId = useRef<number | null>(null);

  // 伺服器資料換了（新增、刪除、換模板、重排成功）就丟掉本機草稿
  useEffect(() => setDraft(null), [catalog]);

  if (!catalog) return <Spinner />;
  const stages = draft ?? catalog;

  /** 把 fromId 移到 toId 的位置——只能在自己的階段裡移動 */
  function move(fromId: number, toId: number) {
    if (fromId === toId) return;
    setDraft((prev) => {
      const list = (prev ?? catalog!).map((s) => ({ ...s, items: [...s.items] }));
      const from = locate(list, fromId);
      const to = locate(list, toId);
      if (!from || !to || from.si !== to.si) return prev;
      const items = list[from.si].items;
      const [moved] = items.splice(from.ii, 1);
      items.splice(to.ii, 0, moved);
      return list;
    });
  }

  /** 放開滑鼠（或按了 ↑↓）才真的送出 */
  function commit(next?: FlowCatalogStage[]) {
    dragId.current = null;
    const list = next ?? draft;
    if (!list) return;
    const ids = list.flatMap((s) => s.items.map((i) => i.id));
    const before = catalog!.flatMap((s) => s.items.map((i) => i.id));
    if (ids.join() === before.join()) {
      setDraft(null);
      return;
    }
    if (next) setDraft(next);
    reorder.mutate(
      { id: templateId, item_ids: ids },
      {
        onError: (e) => {
          setDraft(null);   // 失敗就退回伺服器的順序，不要留一個假的畫面
          toast.error(e instanceof ApiError ? e.body.detail ?? "順序更新失敗" : "順序更新失敗");
        },
      },
    );
  }

  /** ↑↓：觸控裝置拖不動，留著這條路 */
  function nudge(stageId: number, index: number, dir: -1 | 1) {
    const list = stages.map((s) => ({ ...s, items: [...s.items] }));
    const si = list.findIndex((s) => s.id === stageId);
    const j = index + dir;
    if (si < 0 || j < 0 || j >= list[si].items.length) return;
    const items = list[si].items;
    [items[index], items[j]] = [items[j], items[index]];
    commit(list);
  }

  return (
    <div className="mt-2 space-y-2">
      {stages.map((stage) => (
        <StageSection
          key={stage.id}
          stage={stage}
          templateId={templateId}
          onNudge={nudge}
          onDragStart={(id) => (dragId.current = id)}
          onDragOver={(id) => dragId.current !== null && move(dragId.current, id)}
          onDragEnd={() => commit()}
        />
      ))}
      <p className="text-xs text-ink-3">
        拖曳左邊的握把（或用 ↑↓）調順序，<b className="text-ink-2">編號跟著位置即時重編</b>——
        3.4 拖到前面就變 3.3。只能在自己的階段裡移動。
      </p>
    </div>
  );
}

/** 這個 id 在哪一個階段的第幾個 */
function locate(list: FlowCatalogStage[], id: number) {
  for (let si = 0; si < list.length; si++) {
    const ii = list[si].items.findIndex((i) => i.id === id);
    if (ii >= 0) return { si, ii };
  }
  return null;
}

interface DragProps {
  onNudge: (stageId: number, index: number, dir: -1 | 1) => void;
  onDragStart: (id: number) => void;
  onDragOver: (id: number) => void;
  onDragEnd: () => void;
}

function StageSection({
  stage,
  templateId,
  ...drag
}: {
  stage: FlowCatalogStage;
  templateId: number;
} & DragProps) {
  const saveItem = useSaveFlowItem();
  const toast = useToast();
  const [draft, setDraft] = useState("");

  function add() {
    const name = draft.trim();
    if (!name) return;
    saveItem.mutate(
      { template: templateId, stage: stage.id, name },
      {
        onSuccess: () => {
          setDraft("");
          toast.success(`已新增「${name}」`);
        },
        onError: (e) =>
          toast.error(e instanceof ApiError ? e.body.detail ?? "新增失敗" : "新增失敗"),
      },
    );
  }

  return (
    <section className="rounded-xl bg-page p-2.5">
      <p className="text-xs font-bold text-ink">
        第{stage.seq}階段　{stage.name}
        <span className="ml-1.5 font-normal tabular-nums text-ink-3">{stage.items.length} 項</span>
      </p>
      <ul className="mt-1.5 space-y-1">
        {stage.items.map((item, i) => (
          <ItemRow
            key={item.id}
            item={item}
            index={i}
            stage={stage}
            /* D51／D55：編號是**位置**不是身分——依目前順序即時算，拖曳當下就變 */
            code={`${stage.seq}.${i + 1}`}
            {...drag}
          />
        ))}
      </ul>
      <div className="mt-1.5 flex items-center gap-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          placeholder="＋新工作項名稱"
          aria-label={`第${stage.seq}階段新增工作項`}
          className="min-w-0 flex-1 rounded-md border border-line bg-card px-2 py-1 text-xs text-ink"
        />
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim() || saveItem.isPending}
          className="flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-1 text-xs font-semibold text-ink-2 ring-1 ring-line hover:bg-card disabled:opacity-40"
        >
          <Plus size={11} />
          新增
        </button>
      </div>
    </section>
  );
}

const ITEM_SPECS = [
  { key: "description", label: "工作內容" },
  { key: "deliverables", label: "產出物" },
  { key: "done_criteria", label: "完成條件" },
] as const;

function ItemRow({
  item,
  index,
  stage,
  code,
  onNudge,
  onDragStart,
  onDragOver,
  onDragEnd,
}: {
  item: FlowCatalogItem;
  index: number;
  stage: FlowCatalogStage;
  code: string;
} & DragProps) {
  const saveItem = useSaveFlowItem();
  const removeItem = useDeleteFlowItem();
  const toast = useToast();
  const [openSpecs, setOpenSpecs] = useState(false);
  // 只有按住左邊的握把才進入可拖曳狀態——整列都能拖的話，
  // 在名稱欄裡選字會變成拖整列
  const [grab, setGrab] = useState(false);
  const [form, setForm] = useState({
    name: item.name,
    description: item.description,
    deliverables: item.deliverables,
    done_criteria: item.done_criteria,
  });

  function commit(key: keyof typeof form) {
    const value = form[key];
    if (value === item[key]) return;
    if (key === "name" && !value.trim()) {
      setForm((f) => ({ ...f, name: item.name }));
      return;
    }
    saveItem.mutate(
      { id: item.id, [key]: value },
      {
        onError: (e) => {
          setForm((f) => ({ ...f, [key]: item[key] }));
          toast.error(e instanceof ApiError ? e.body.detail ?? "更新失敗" : "更新失敗");
        },
      },
    );
  }

  function remove() {
    if (item.in_use) {
      if (!window.confirm(`「${item.name}」已有案子用過，改為停用（之後的新案不再出現）？`)) return;
      removeItem.mutate(
        { id: item.id, deactivate: true },
        {
          onSuccess: () => toast.success(`「${item.name}」已停用`),
          onError: (e) =>
            toast.error(e instanceof ApiError ? e.body.detail ?? "停用失敗" : "停用失敗"),
        },
      );
      return;
    }
    if (!window.confirm(`刪除「${item.name}」？`)) return;
    removeItem.mutate(
      { id: item.id },
      {
        onError: (e) =>
          toast.error(e instanceof ApiError ? e.body.detail ?? "刪除失敗" : "刪除失敗"),
      },
    );
  }

  return (
    <li
      draggable={grab}
      onDragStart={(e) => {
        onDragStart(item.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver(item.id);
      }}
      onDragEnd={() => {
        setGrab(false);
        onDragEnd();
      }}
      onDrop={(e) => e.preventDefault()}
      onMouseUp={() => setGrab(false)}
      className={[
        "rounded-lg bg-card px-2 py-1.5 ring-1 ring-line",
        grab ? "ring-stage-2" : "",
      ].join(" ")}
    >
      <div className="flex items-center gap-1.5">
        <span
          onMouseDown={() => setGrab(true)}
          onTouchStart={() => setGrab(true)}
          aria-label={`拖曳 ${item.name} 調整順序`}
          className="shrink-0 cursor-grab touch-none p-0.5 text-ink-3 active:cursor-grabbing"
        >
          <GripVertical size={13} aria-hidden />
        </span>
        <span className="w-8 shrink-0 text-xs font-semibold tabular-nums text-ink-3">
          {code}
        </span>
        <input
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          onBlur={() => commit("name")}
          aria-label={`${item.code} 名稱`}
          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs font-semibold text-ink hover:border-line focus:border-line focus:bg-page"
        />
        {item.is_gate && (
          <span className="shrink-0 rounded bg-page px-1 py-px text-[11px] font-semibold text-ink-2">
            關卡
          </span>
        )}
        <button
          type="button"
          onClick={() => onNudge(stage.id, index, -1)}
          aria-label={`${item.name} 上移`}
          className="shrink-0 rounded px-1 py-0.5 text-xs text-ink-3 hover:bg-page"
        >
          ↑
        </button>
        <button
          type="button"
          onClick={() => onNudge(stage.id, index, 1)}
          aria-label={`${item.name} 下移`}
          className="shrink-0 rounded px-1 py-0.5 text-xs text-ink-3 hover:bg-page"
        >
          ↓
        </button>
        <button
          type="button"
          onClick={() => setOpenSpecs((v) => !v)}
          aria-label={`${item.name} 預設內容`}
          className="shrink-0 rounded p-0.5 text-ink-3 hover:bg-page"
        >
          <ChevronDown size={13} className={openSpecs ? "rotate-180" : ""} />
        </button>
        <button
          type="button"
          onClick={remove}
          aria-label={`刪除 ${item.name}`}
          className="shrink-0 rounded p-0.5 text-ink-3 hover:text-[var(--color-delayed)]"
        >
          <X size={13} />
        </button>
      </div>
      {openSpecs && (
        <div className="mt-1.5 space-y-1">
          {ITEM_SPECS.map((s) => (
            <label key={s.key} className="block">
              <span className="text-[11px] font-semibold text-ink-3">{s.label}（新案的預設值）</span>
              <textarea
                rows={2}
                value={form[s.key]}
                onChange={(e) => setForm((f) => ({ ...f, [s.key]: e.target.value }))}
                onBlur={() => commit(s.key)}
                className={`${inputClass} mb-0 mt-0.5 text-xs leading-relaxed`}
              />
            </label>
          ))}
        </div>
      )}
    </li>
  );
}
