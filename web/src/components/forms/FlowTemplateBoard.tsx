/**
 * 流程模板維護（設定 → 流程模板，D49）
 *
 * 回答的問題：**新案的起手流程長什麼樣**。
 * 只有經理與系統管理員看得到這個分頁；改的是「之後新建案子的預設」，
 * 已建案子的流程早就抄走了，不會被回頭改動。
 *
 * 能做的事：新增／複製／改名／停用模板、設定預設模板；
 * 模板內：加工作項、改名稱與預設的工作內容三欄、調順序、刪（用過的只能停用）。
 */
import { Check, ChevronDown, Copy, Plus, Star, Trash2, X } from "lucide-react";
import { useState } from "react";

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

/** 模板內容：五大階段 × 工作項（加、改、刪、調順序） */
function TemplateItems({ templateId }: { templateId: number }) {
  const { data: catalog } = useFlowCatalog(true, templateId);
  const reorder = useReorderFlowTemplate();
  const toast = useToast();

  if (!catalog) return <Spinner />;

  /** 全部啟用中工作項的 id，依（階段、目前順序）——上下移動時整串重送 */
  function orderedIds(swap?: [number, number]) {
    const ids = catalog!.flatMap((s) => s.items.map((i) => i.id));
    if (swap) {
      const [a, b] = swap.map((id) => ids.indexOf(id));
      if (a >= 0 && b >= 0) [ids[a], ids[b]] = [ids[b], ids[a]];
    }
    return ids;
  }

  function nudge(stage: FlowCatalogStage, index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= stage.items.length) return;
    reorder.mutate(
      { id: templateId, item_ids: orderedIds([stage.items[index].id, stage.items[j].id]) },
      {
        onError: (e) =>
          toast.error(e instanceof ApiError ? e.body.detail ?? "順序更新失敗" : "順序更新失敗"),
      },
    );
  }

  return (
    <div className="mt-2 space-y-2">
      {catalog.map((stage) => (
        <StageSection key={stage.id} stage={stage} templateId={templateId} onNudge={nudge} />
      ))}
    </div>
  );
}

function StageSection({
  stage,
  templateId,
  onNudge,
}: {
  stage: FlowCatalogStage;
  templateId: number;
  onNudge: (stage: FlowCatalogStage, index: number, dir: -1 | 1) => void;
}) {
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
          <ItemRow key={item.id} item={item} index={i} stage={stage} onNudge={onNudge} />
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
  onNudge,
}: {
  item: FlowCatalogItem;
  index: number;
  stage: FlowCatalogStage;
  onNudge: (stage: FlowCatalogStage, index: number, dir: -1 | 1) => void;
}) {
  const saveItem = useSaveFlowItem();
  const removeItem = useDeleteFlowItem();
  const toast = useToast();
  const [openSpecs, setOpenSpecs] = useState(false);
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
    <li className="rounded-lg bg-card px-2 py-1.5 ring-1 ring-line">
      <div className="flex items-center gap-1.5">
        <span className="w-8 shrink-0 text-xs font-semibold tabular-nums text-ink-3">
          {item.code}
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
          onClick={() => onNudge(stage, index, -1)}
          aria-label={`${item.name} 上移`}
          className="shrink-0 rounded px-1 py-0.5 text-xs text-ink-3 hover:bg-page"
        >
          ↑
        </button>
        <button
          type="button"
          onClick={() => onNudge(stage, index, 1)}
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
