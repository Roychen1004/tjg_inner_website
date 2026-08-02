import { Construction } from "lucide-react";

/**
 * 尚未開發的畫面
 *
 * W3 只做認證與骨架。各畫面在後續階段依序實作，
 * 這裡明確告知「還沒做」與「什麼時候會有」——
 * 比放一個空白頁或假資料誠實。
 */
export default function Placeholder({
  title,
  phase,
  description,
}: {
  title: string;
  phase: string;
  description: string;
}) {
  return (
    <div className="rounded-xl bg-card p-8 text-center ring-1 ring-line">
      <Construction size={32} className="mx-auto text-ink-3" />
      <h2 className="mt-3 text-base font-bold text-ink">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-2">{description}</p>
      <p className="mt-4 inline-block rounded-full bg-page px-3 py-1 text-xs font-semibold text-ink-3">
        {phase} 實作
      </p>
    </div>
  );
}
