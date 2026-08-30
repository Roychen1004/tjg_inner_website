/**
 * 全域唯一的流程卡片側欄（D49）
 *
 * D48 拿掉遮罩之後，每個頁面各自掛一份側欄的做法出了問題：
 * 點 A 專案的流程開一層、點 B 專案的又疊一層——關一層底下還有一層，
 * 看起來就像「工作內容區塊不斷複製」（老闆回報的 bug）。
 *
 * 改成整個 App 只有**一個**側欄，掛在 AppShell 的版面層：
 *   · 點任何地方的流程 → 同一個側欄換內容，永遠只有一層
 *   · 桌機上側欄是版面的一欄（不是浮在上面）——主內容被往左擠，
 *     兩邊同一個平面、都能點選捲動（老闆要的效果）
 * 頁面元件只管呼叫 open(id)，不再自己掛 <FlowUnitModal>。
 */
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

interface UnitPanelState {
  unitId: number | null;
  open: (id: number) => void;
  close: () => void;
}

const Ctx = createContext<UnitPanelState>({
  unitId: null,
  open: () => {},
  close: () => {},
});

export function UnitPanelProvider({ children }: { children: ReactNode }) {
  const [unitId, setUnitId] = useState<number | null>(null);
  const open = useCallback((id: number) => setUnitId(id), []);
  const close = useCallback(() => setUnitId(null), []);
  const value = useMemo(() => ({ unitId, open, close }), [unitId, open, close]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUnitPanel() {
  return useContext(Ctx);
}
