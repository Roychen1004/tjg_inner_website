/**
 * 流程勾選器：五大階段 × 19 工作項的核取清單
 *
 * 建案表單與「編輯流程」共用。兩條規則：
 *   · 順序永遠是目錄的順序，**不能拖拉重排**——訂料一定排在放樣後面
 *   · 預設全勾，再把不需要的取消（老闆確認過的做法）
 */
import type { FlowCatalogStage } from "@/api/types";

export default function FlowPicker({
  stages,
  selected,
  onChange,
}: {
  stages: FlowCatalogStage[];
  selected: Set<number>;
  onChange: (next: Set<number>) => void;
}) {
  function toggle(id: number) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  function toggleStage(stage: FlowCatalogStage) {
    const ids = stage.items.map((i) => i.id);
    const allOn = ids.every((id) => selected.has(id));
    const next = new Set(selected);
    for (const id of ids) {
      if (allOn) next.delete(id);
      else next.add(id);
    }
    onChange(next);
  }

  return (
    <div className="space-y-2">
      {stages.map((stage) => {
        const picked = stage.items.filter((i) => selected.has(i.id)).length;
        return (
          <section key={stage.id} className="rounded-xl bg-page p-2.5">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={picked === stage.items.length && stage.items.length > 0}
                // 部分勾選時顯示半選狀態
                ref={(el) => {
                  if (el) el.indeterminate = picked > 0 && picked < stage.items.length;
                }}
                onChange={() => toggleStage(stage)}
                className="h-4 w-4 accent-[var(--color-stage-2)]"
              />
              <span className="text-xs font-bold text-ink">
                第{stage.seq}階段　{stage.name}
              </span>
              <span className="ml-auto text-[11px] tabular-nums text-ink-3">
                {picked}/{stage.items.length}
              </span>
            </label>
            <ul className="mt-1.5 space-y-0.5 pl-6">
              {stage.items.map((item) => (
                <li key={item.id}>
                  <label className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-0.5 hover:bg-card">
                    <input
                      type="checkbox"
                      checked={selected.has(item.id)}
                      onChange={() => toggle(item.id)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-stage-2)]"
                    />
                    <span className="min-w-0 text-xs leading-snug text-ink">
                      <span className="mr-1 font-semibold tabular-nums text-ink-3">{item.code}</span>
                      {item.name}
                      {item.is_gate && (
                        <span className="ml-1.5 rounded bg-card px-1 py-px text-[10px] font-semibold text-ink-2">
                          關卡
                        </span>
                      )}
                      {item.batch_stage_seq !== null && (
                        <span className="ml-1.5 text-[10px] text-ink-3">批次自動彙總</span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <p className="text-[11px] leading-relaxed text-ink-3">
        流程順序是固定的（訂料一定排在放樣收點後面），只能勾選要不要，不能調順序。
        建案後隨時可以在專案明細用「編輯流程」加減。
      </p>
    </div>
  );
}
