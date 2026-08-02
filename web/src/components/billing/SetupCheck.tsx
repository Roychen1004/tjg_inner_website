/**
 * 請款設定檢查
 *
 * 請款自動化要能跑，前置條件有五、六項。任何一項沒做，
 * 結果都是「簽收了但什麼都沒發生」——而畫面上看不出是哪裡沒做。
 *
 * 這個元件把「你還缺什麼」直接講出來，每一項都答三個問題：
 *   現在怎樣 · 為什麼重要 · 該去哪裡做
 */
import { AlertTriangle, CheckCircle2, ChevronDown, XCircle } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { api } from "@/api/client";
import { Card } from "@/components/ui";
import { useQuery } from "@tanstack/react-query";

interface CheckItem {
  key: string;
  title: string;
  status: "ok" | "warn" | "block";
  detail: string;
  why: string;
  action: string;
  link: string;
}

interface CheckResult {
  ready: boolean;
  summary: string;
  blocking_count: number;
  warning_count: number;
  items: CheckItem[];
}

const META = {
  ok: { icon: CheckCircle2, color: "var(--color-ontrack)", bg: "var(--color-ontrack-bg)" },
  warn: { icon: AlertTriangle, color: "var(--color-atrisk)", bg: "var(--color-atrisk-bg)" },
  block: { icon: XCircle, color: "var(--color-delayed)", bg: "var(--color-delayed-bg)" },
} as const;

export function useSetupCheck(projectId: number | null) {
  return useQuery({
    queryKey: ["billing", "setup-check", projectId],
    queryFn: () =>
      api.get<CheckResult>("/billing-milestones/setup-check", { project: projectId! }),
    enabled: projectId !== null,
  });
}

export default function SetupCheck({
  projectId,
  defaultOpen,
}: {
  projectId: number;
  /** 有問題時預設展開；一切正常時收合，不佔版面 */
  defaultOpen?: boolean;
}) {
  const { data } = useSetupCheck(projectId);
  const [open, setOpen] = useState<boolean | null>(null);

  if (!data) return null;

  const hasIssue = data.blocking_count > 0 || data.warning_count > 0;
  const expanded = open ?? defaultOpen ?? hasIssue;
  const tone = data.blocking_count ? "block" : data.warning_count ? "warn" : "ok";
  const meta = META[tone];
  const Icon = meta.icon;

  return (
    <Card className="mb-3 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!expanded)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        <Icon size={16} style={{ color: meta.color }} className="shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-ink">請款設定檢查</span>
          <span className="block text-[11px]" style={{ color: meta.color }}>
            {data.summary}
          </span>
        </span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-ink-3 transition-base ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      {expanded && (
        <ul className="divide-y divide-line border-t border-line">
          {data.items.map((item) => (
            <CheckRow key={item.key} item={item} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function CheckRow({ item }: { item: CheckItem }) {
  const meta = META[item.status];
  const Icon = meta.icon;
  const done = item.status === "ok";

  return (
    <li className="flex gap-2.5 px-3 py-2.5">
      <Icon size={15} style={{ color: meta.color }} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className={`text-xs font-semibold ${done ? "text-ink-2" : "text-ink"}`}>
          {item.title}
        </p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-ink-2">{item.detail}</p>

        {/* 只在有問題時展開「為什麼」與「該做什麼」——
            已經做好的項目講一堆理由只是雜訊 */}
        {!done && item.why && (
          <div className="mt-1.5 rounded-lg px-2.5 py-1.5" style={{ background: meta.bg }}>
            <p className="text-[11px] leading-relaxed" style={{ color: meta.color }}>
              {item.why}
            </p>
          </div>
        )}
        {!done && item.action && (
          <p className="mt-1.5 text-[11px] leading-relaxed text-ink-2">
            <span className="font-semibold text-ink">該做的：</span>
            {item.link ? (
              <Link to={item.link} className="font-semibold text-stage-2 hover:underline">
                {item.action} →
              </Link>
            ) : (
              item.action
            )}
          </p>
        )}
      </div>
    </li>
  );
}
