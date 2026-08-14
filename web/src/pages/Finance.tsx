/**
 * 金流
 *
 * 回答的問題：**錢進來、錢出去、未來會不會缺。**
 *
 * 三個子頁是同一件事的三個角度：
 *   應收　　一筆一筆看，錢什麼時候進來
 *   應付　　一筆一筆看，錢什麼時候出去
 *   現金流　加總起來看，未來哪一週會缺
 *
 * 合成一個導航分頁而不是三個：看這三個畫面的是同樣的人（老闆與會計），
 * 問的是同一個問題。
 */
import { lazy, Suspense } from "react";

import { Spinner } from "@/components/ui";
import { useStickyParams } from "@/lib/stickyParams";

const Receivables = lazy(() => import("@/pages/Billing"));
const Payables = lazy(() => import("@/pages/Payables"));
const Cashflow = lazy(() => import("@/pages/Cashflow"));

const TABS = [
  { key: "in", label: "應收（錢進來）" },
  { key: "out", label: "應付（錢出去）" },
  { key: "cashflow", label: "現金流預測" },
] as const;

export default function Finance() {
  const [searchParams, setSearchParams] = useStickyParams("finance.tab", ["tab"]);
  // 從「需要關注」點過來的連結帶著 ?payable=，直接落在對的子頁
  const fallback = searchParams.get("payable") ? "out" : "in";
  const tab = searchParams.get("tab") ?? fallback;

  const setTab = (v: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", v);
    setSearchParams(next, { replace: true });
  };

  return (
    <div>
      <div className="mb-4 flex rounded-lg bg-page p-0.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={[
              "flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-base",
              tab === t.key ? "bg-card text-ink shadow-sm" : "text-ink-3",
            ].join(" ")}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Suspense fallback={<Spinner />}>
        {tab === "out" ? <Payables /> : tab === "cashflow" ? <Cashflow /> : <Receivables />}
      </Suspense>
    </div>
  );
}
