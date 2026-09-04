/**
 * 行政類別維護（D53）——繳費、打掃、其他……
 *
 * 顏色就是日曆上的色塊顏色。用過的類別不給刪（歷史會變孤兒），
 * 後端擋下來時就提示改為停用。
 */
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { ApiError } from "@/api/client";
import {
  useAffairCategories,
  useDeleteAffairCategory,
  useSaveAffairCategory,
} from "@/api/hooks";
import { Button, Modal, inputClass } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";

// 日曆色塊用的一排顏色——跟系統的階段色同一組色系。
// 表單裡直接新增類別時也拿它配色（D56），兩處同一組色不會走鐘
export const PALETTE = [
  "#f59e0b", "#10b981", "#6366f1", "#0ea5e9",
  "#d97706", "#8b5cf6", "#ef4444", "#64748b",
];

export default function CategoryManager({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { data: categories } = useAffairCategories(true);
  const save = useSaveAffairCategory();
  const remove = useDeleteAffairCategory();
  const toast = useToast();
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PALETTE[0]);

  function fail(e: unknown) {
    toast.error(e instanceof ApiError ? e.body.detail ?? "操作失敗" : "操作失敗");
  }

  function add() {
    const name = newName.trim();
    if (!name) return;
    save.mutate(
      { name, color: newColor },
      {
        onSuccess: () => {
          setNewName("");
          toast.success(`已新增類別「${name}」`);
        },
        onError: fail,
      },
    );
  }

  return (
    <Modal open={open} onClose={onClose} title="行政類別">
      <ul className="mb-4 space-y-2">
        {(categories ?? []).map((c) => (
          <li key={c.id} className="flex items-center gap-2">
            <input
              type="color"
              value={c.color}
              onChange={(e) =>
                save.mutate({ id: c.id, color: e.target.value }, { onError: fail })
              }
              aria-label={`${c.name} 的顏色`}
              className="h-9 w-9 shrink-0 cursor-pointer rounded-lg border border-line bg-card p-0.5"
            />
            <input
              defaultValue={c.name}
              onBlur={(e) => {
                const name = e.target.value.trim();
                if (name && name !== c.name) {
                  save.mutate({ id: c.id, name }, { onError: fail });
                }
              }}
              aria-label={`${c.name} 的名稱`}
              className={`${inputClass} flex-1`}
              style={{ opacity: c.is_active ? 1 : 0.5 }}
            />
            <button
              type="button"
              onClick={() =>
                save.mutate({ id: c.id, is_active: !c.is_active }, { onError: fail })
              }
              className="shrink-0 rounded-lg border border-line px-2.5 py-2 text-xs font-semibold text-ink-2 transition-base hover:bg-page"
            >
              {c.is_active ? "停用" : "啟用"}
            </button>
            <button
              type="button"
              onClick={() =>
                remove.mutate(c.id, {
                  onSuccess: () => toast.success(`已刪除「${c.name}」`),
                  onError: fail,
                })
              }
              aria-label={`刪除 ${c.name}`}
              className="shrink-0 rounded-lg p-2 text-ink-3 transition-base hover:bg-page"
            >
              <Trash2 size={15} />
            </button>
          </li>
        ))}
      </ul>

      <div className="border-t border-line pt-3">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {PALETTE.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => setNewColor(color)}
              aria-label={`選顏色 ${color}`}
              aria-pressed={color === newColor}
              className="h-7 w-7 rounded-full border-2 transition-base"
              style={{
                background: color,
                borderColor: color === newColor ? "var(--color-ink)" : "transparent",
              }}
            />
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="新類別，如「報稅」"
            className={`${inputClass} flex-1`}
          />
          <Button variant="primary" onClick={add} loading={save.isPending}>
            <Plus size={14} />
            新增
          </Button>
        </div>
      </div>
    </Modal>
  );
}
