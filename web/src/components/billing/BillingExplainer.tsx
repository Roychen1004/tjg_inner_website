/**
 * 「合約里程碑」與「請款事件」差在哪
 *
 * 這兩個名詞是整個請款模組最容易搞混的地方，而搞混的代價很實際：
 * 不知道里程碑要自己建，請款頁就永遠是空的。
 *
 * 與其寫在文件裡等人去讀，不如放在他困惑的當下。
 */
import { HelpCircle } from "lucide-react";
import { useState } from "react";

import { Modal } from "@/components/ui";

export function BillingHelpButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 min-h-0 items-center gap-1 rounded-lg px-2 text-xs
                   font-semibold text-stage-2 hover:bg-page"
      >
        <HelpCircle size={14} />
        這兩個差在哪？
      </button>
      <BillingExplainer open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function BillingExplainer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="請款是怎麼運作的">
      <p className="text-sm leading-relaxed text-ink-2">
        一句話：<strong className="text-ink">里程碑是「合約寫的條件」，請款事件是「實際可以開的那筆錢」。</strong>
      </p>

      <div className="mt-4 overflow-x-auto rounded-lg bg-page p-3">
        <pre className="text-[11px] leading-relaxed text-ink-2">{`專案　固越企業總部案　合約 8,000 萬
│
├─ 期別（工程的分期）
│   ├─ 第一期 ─── 1F鋼柱、桁架A區、樓板鋼樑、樓梯鋼構
│   └─ 第二期 ─── 2F鋼柱、樓板鋼樑、樓梯鋼構
│                        │
│                        │ 業主簽收
│                        ↓
└─ 合約里程碑（你自己建，抄合約）
    ├─ 1. 簽約訂金        30%  手動
    ├─ 2. 第一期請款      30%  該期全部簽收 ←─ 綁「第一期」
    ├─ 3. 第二期請款      30%  累計重量達 80% ←─ 綁「第二期」
    └─ 4. 完工尾款        10%  手動
             │
             │ 條件達成，系統自動產生
             ↓
        請款事件（實際的錢）
          2,400 萬  可請款 → 已請款 → 已收款`}</pre>
      </div>

      <Section title="合約里程碑 ── 計畫">
        <Row label="是什麼" value="合約上寫的每一條請款條件" />
        <Row label="誰建的" value="你自己建。簽約後把合約條款抄進系統" />
        <Row label="什麼時候建" value="接到案子、簽完約就建。不建的話請款頁永遠是空的" />
        <Row label="幾筆" value="合約寫幾條就幾筆。通常 3～5 筆" />
      </Section>

      <Section title="請款事件 ── 事實">
        <Row label="是什麼" value="實際可以開發票的那一筆錢" />
        <Row label="誰建的" value="系統自動產生（簽收觸發）。手動型的里程碑由會計自己按" />
        <Row label="什麼時候出現" value="里程碑的觸發條件達成的那一刻" />
        <Row label="幾筆" value="看觸發方式。分批請款的話，一條里程碑會生出很多筆" />
      </Section>

      <h3 className="mt-4 text-sm font-bold text-ink">為什麼要分兩層？</h3>
      <p className="mt-1 text-xs leading-relaxed text-ink-2">
        因為合約寫「<strong className="text-ink">按實際交貨數量分批請領</strong>」時，
        <strong className="text-ink">一條里程碑會產生好幾筆錢</strong>：
      </p>
      <div className="mt-2 overflow-x-auto rounded-lg bg-page p-3">
        <pre className="text-[11px] leading-relaxed text-ink-2">{`分批交付計價　5,040 萬　每批按量分批請
  ├─ 桁架A區 42 噸 → 3,024 萬　已收款  ✔
  ├─ 桁架B區 28 噸 → 2,016 萬　已請款
  └─ 桁架C區 尚未簽收 ──────────  未產生`}</pre>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-ink-2">
        同一條合約條件，三批的狀態完全不同。
        塞在一層裡沒辦法同時表達「已收、已請、還沒到」——所以拆成兩層。
      </p>

      <h3 className="mt-4 text-sm font-bold text-ink">跟「期別」的關係</h3>
      <p className="mt-1 text-xs leading-relaxed text-ink-2">
        期別是<strong className="text-ink">工程的分期</strong>（第一期／第二期），不是分期付款。
        里程碑可以綁一個期別，意思是「這條請款條件只看該期的批次」。
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-2">
        某一批簽收時，系統先看它屬於哪一期 → 找到該期的里程碑 → 評估條件有沒有達成。
        <strong className="text-ink">沒有分期的專案，里程碑就以全案為範圍</strong>，一樣能運作。
      </p>

      <h3 className="mt-4 text-sm font-bold text-ink">你該做什麼</h3>
      <ol className="mt-1 space-y-1.5 text-xs leading-relaxed text-ink-2">
        <li>
          <strong className="text-ink">1.</strong> 簽完約 → 到「合約里程碑」分頁，
          把合約上每一條請款條件建成一筆
        </li>
        <li>
          <strong className="text-ink">2.</strong> 如果合約是分期的 →
          先到專案頁建期別，再把里程碑綁上去
        </li>
        <li>
          <strong className="text-ink">3.</strong> 之後就不用管了。現場登錄簽收時，
          系統會自己判斷要不要產生請款事件，並通知會計
        </li>
        <li>
          <strong className="text-ink">4.</strong> 會計在「請款事件」分頁把狀態
          從「可請款」推到「已請款」→「已收款」
        </li>
      </ol>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <h3 className="text-sm font-bold text-ink">{title}</h3>
      <dl className="mt-1 space-y-1">{children}</dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 text-xs leading-relaxed">
      <dt className="w-[68px] shrink-0 text-ink-3">{label}</dt>
      <dd className="flex-1 text-ink-2">{value}</dd>
    </div>
  );
}
