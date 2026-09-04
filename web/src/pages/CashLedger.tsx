/**
 * 收支明細（D55）
 *
 * **這個畫面只回答一個問題：這段期間，錢在哪一天進出、進出給誰。**
 *
 * 跟隔壁的「現金流預測」是同一份資料的兩個角度：
 *   預測　分格、算累計、只看未來——回答「哪個月會缺錢」
 *   明細　不分格、不算累計、連已經收付的也列——回答「錢花到哪裡去了」
 *
 * 三個設計：
 *   ① **一天一組**。這是一本帳，時間是它的骨架；同一天的收付要放在一起看
 *   ② **來源分得出來**。案子的錢與行政的錢混在一起就沒有意義了，
 *      所以每一列都寫著是哪個案子、或哪一件行政事項，也可以只看其中一種
 *   ③ **已發生與預計分開標**。「已收款」跟「預計收款」不是同一件事，
 *      混成一個數字會讓人以為錢已經進來了
 */
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";

import { useCashLedger, useOptions } from "@/api/hooks";
import type { LedgerRow, MoneySource } from "@/api/types";
import { Card, EmptyState, ErrorState, Money, Segmented, Select, Spinner } from "@/components/ui";
import { useStickyParams } from "@/lib/stickyParams";

const KEYS = ["month", "source", "dir", "project"];
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}
/** "YYYY-MM" → 這個月的第一天與最後一天 */
function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(last)}` };
}
function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
function thisMonth() {
  const t = new Date();
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}`;
}

export default function CashLedger() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useStickyParams("ledger.filters", KEYS);
  const month = searchParams.get("month") || thisMonth();
  const source = (searchParams.get("source") || "all") as MoneySource | "all";
  const direction = searchParams.get("dir") || "";
  // 專案只在「只看案子」時有意義；其他來源下一律當成沒選
  const project = source === "project" ? searchParams.get("project") || "" : "";
  const { data: options } = useOptions();

  const setParam = (name: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(name, value);
    else next.delete(name);
    setSearchParams(next, { replace: true });
  };
  // 換來源時要把專案一起清掉——不然它會靜靜留在網址裡，
  // 下次切回「只看案子」突然又只剩一個案子，看的人會以為資料不見了
  const setSource = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set("source", value);
    else next.delete("source");
    if (value !== "project") next.delete("project");
    setSearchParams(next, { replace: true });
  };

  const { start, end } = useMemo(() => monthRange(month), [month]);
  const { data, isLoading, error, refetch } = useCashLedger({
    start,
    end,
    source: source === "all" ? undefined : source,
    project: project || undefined,
    direction: direction || undefined,
  });

  const today = new Date().toISOString().slice(0, 10);
  // 明細連已結案的案子也列（收過的錢不會因為案子結了就消失），
  // 所以下拉也要有它們——結案的排在後面並標明，免得跟進行中的混在一起
  const projectList = useMemo(() => {
    if (!options) return undefined;
    return [
      ...options.projects.map((p) => ({ ...p, closed: false })),
      ...(options.closed_projects ?? []).map((p) => ({ ...p, closed: true })),
    ];
  }, [options]);
  const projectName = projectList?.find((p) => String(p.id) === project)?.name || "";

  // 記在瀏覽器裡的專案若已經被刪掉，這頁會變成空的卻查不出原因——直接清掉它
  useEffect(() => {
    if (!project || !projectList) return;
    if (!projectList.some((p) => String(p.id) === project)) setParam("project", "");
    // setParam 每次 render 都是新的函式，放進相依會無限迴圈
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, projectList]);

  function open(row: LedgerRow) {
    if (row.source_kind === "affair") navigate(`/affairs?date=${row.date}`);
    else if (row.kind === "milestone") navigate(`/finance?tab=in&milestone=${row.id}`);
    else if (row.kind === "payable") navigate(`/finance?tab=out&payable=${row.id}`);
    else navigate("/finance?tab=out");
  }

  return (
    <div className="space-y-4">
      {/* 期間與篩選 */}
      <section className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg bg-card px-1 py-0.5 ring-1 ring-line">
          <button
            type="button"
            aria-label="上個月"
            onClick={() => setParam("month", shiftMonth(month, -1))}
            className="rounded p-1.5 text-ink-3 transition-base hover:bg-page"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="min-w-28 text-center text-sm font-bold tabular-nums text-ink">
            {month.replace("-", " 年 ")} 月
          </span>
          <button
            type="button"
            aria-label="下個月"
            onClick={() => setParam("month", shiftMonth(month, 1))}
            className="rounded p-1.5 text-ink-3 transition-base hover:bg-page"
          >
            <ChevronRight size={16} />
          </button>
        </div>
        {month !== thisMonth() && (
          <button
            type="button"
            onClick={() => setParam("month", "")}
            className="rounded-lg px-2 py-1.5 text-xs font-semibold text-ink-2 ring-1 ring-line transition-base hover:bg-page"
          >
            回本月
          </button>
        )}
        <Segmented
          value={source}
          onChange={(v) => setSource(v === "all" ? "" : v)}
          options={[
            { value: "all", label: "全部" },
            { value: "project", label: "只看案子" },
            { value: "affair", label: "只看行政" },
          ]}
        />
        {/* 只看案子時才出現：要單獨看哪一個案子 */}
        {source === "project" && (
          <Select
            value={project}
            onChange={(v) => setParam("project", v)}
            options={(projectList ?? []).map((p) => ({
              value: p.id,
              label: p.closed ? `${p.name}（已結案）` : p.name,
            }))}
            placeholder="全部案子"
          />
        )}
        <Select
          value={direction}
          onChange={(v) => setParam("dir", v)}
          options={[
            { value: "in", label: "只看收入" },
            { value: "out", label: "只看支出" },
          ]}
          placeholder="收入與支出"
        />
      </section>

      {isLoading ? (
        <Spinner label="整理收支…" />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !data ? (
        <EmptyState title="沒有資料" />
      ) : (
        <>
          <section className="grid gap-2 sm:grid-cols-3">
            <Total
              label="這個月收入"
              value={data.totals.income}
              actual={data.totals.actual_income}
              tone="in"
            />
            <Total
              label="這個月支出"
              value={data.totals.expense}
              actual={data.totals.actual_expense}
              tone="out"
            />
            <Total label="淨額" value={data.totals.net} signed />
          </section>

          {data.days.length === 0 ? (
            <EmptyState
              title="這個月沒有收支紀錄"
              hint={
                project
                  ? `「${projectName || "這個案子"}」這個月沒有收付；翻到別的月份，或把案子條件清掉看看`
                  : source !== "all" || direction
                  ? "換個篩選條件，或翻到別的月份看看"
                  : "收入來自應收款（已收與預計收），支出來自應付款項與行政事項填的金額；都沒有的話這本帳就是空的"
              }
            />
          ) : (
            <div className="overflow-hidden rounded-xl bg-card ring-1 ring-line">
              {data.days.map((day) => (
                <section key={day.date}>
                  {/* 日期分隔列：這一天總共收多少、付多少 */}
                  <div
                    className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-y border-line bg-page px-3 py-1.5"
                    style={day.date === today ? { background: "var(--color-stage-2-bg, var(--color-page))" } : undefined}
                  >
                    <span className="text-sm font-bold tabular-nums text-ink">
                      {Number(day.date.slice(5, 7))}/{Number(day.date.slice(8, 10))}
                    </span>
                    <span className="text-xs text-ink-3">
                      （{WEEKDAYS[new Date(day.date).getDay()]}）
                    </span>
                    {day.date === today && (
                      <span className="rounded bg-stage-2 px-1.5 py-px text-[11px] font-bold text-white">
                        今天
                      </span>
                    )}
                    <span className="ml-auto flex items-center gap-3 text-xs font-semibold tabular-nums">
                      {Number(day.income) > 0 && (
                        <span style={{ color: "var(--color-ontrack)" }}>
                          收 <Money value={day.income} compact />
                        </span>
                      )}
                      {Number(day.expense) > 0 && (
                        <span style={{ color: "var(--color-delayed)" }}>
                          付 <Money value={day.expense} compact />
                        </span>
                      )}
                    </span>
                  </div>
                  <ul className="divide-y divide-line">
                    {day.rows.map((row) => (
                      <Row key={`${row.kind}-${row.id}-${row.direction}`} row={row} onOpen={open} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}

          <p className="rounded-lg bg-page px-3 py-2 text-xs leading-relaxed text-ink-2">
            共 {data.count} 筆。
            <b className="text-ink">已收／已付</b>是真的進出過帳戶的錢；
            <b className="text-ink">預計</b>還沒發生（日期是帳期或人填的），
            半透明的那幾筆是<b className="text-ink">預估</b>（例如合約未計價餘額按月均攤）。
            點任何一列可以跳到那筆的來源。
          </p>
          <p className="text-xs leading-relaxed text-ink-3">
            {data.disclaimer}
            {project && " 目前只看單一案子，所以不含行政事項的收支。"}
          </p>
        </>
      )}
    </div>
  );
}

function Total({
  label,
  value,
  actual,
  tone,
  signed = false,
}: {
  label: string;
  value: string;
  actual?: string;
  tone?: "in" | "out";
  signed?: boolean;
}) {
  const num = Number(value);
  const color =
    tone === "in"
      ? "var(--color-ontrack)"
      : tone === "out"
        ? "var(--color-delayed)"
        : num < 0
          ? "var(--color-delayed)"
          : "var(--color-ink)";
  return (
    <Card className="p-3">
      <p className="text-xs font-semibold text-ink-2">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums" style={{ color }}>
        {signed && num > 0 && "+"}
        {tone === "out" && "-"}
        {signed && num < 0 && "-"}
        <Money value={Math.abs(num)} compact />
        <span className="ml-1 text-xs font-normal text-ink-3">元</span>
      </p>
      {actual !== undefined && (
        <p className="mt-0.5 text-xs text-ink-3">
          其中已{tone === "in" ? "收" : "付"} <Money value={actual} compact /> 元、
          預計 <Money value={Number(value) - Number(actual)} compact /> 元
        </p>
      )}
    </Card>
  );
}

function Row({ row, onOpen }: { row: LedgerRow; onOpen: (row: LedgerRow) => void }) {
  const isIn = row.direction === "in";
  const color = isIn ? "var(--color-ontrack)" : "var(--color-delayed)";
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(row)}
        className={[
          "flex w-full items-center gap-2 px-3 py-2 text-left transition-base hover:bg-page",
          row.certainty === "estimated" ? "opacity-70" : "",
        ].join(" ")}
      >
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
          style={{ background: isIn ? "var(--color-ontrack-bg)" : "var(--color-delayed-bg)", color }}
          aria-hidden
        >
          {isIn ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="truncate text-sm font-semibold text-ink">{row.title}</span>
            <span
              className="rounded px-1 py-px text-[11px] font-semibold"
              style={
                row.source_kind === "affair"
                  ? { background: "var(--color-atrisk-bg)", color: "var(--color-atrisk)" }
                  : { background: "var(--color-page)", color: "var(--color-ink-2)" }
              }
            >
              {row.source_kind === "affair" ? `行政·${row.party}` : row.source}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-xs text-ink-3">
            {row.source_kind === "affair" ? row.note : `${row.party}·${row.note}`}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-sm font-bold tabular-nums" style={{ color }}>
            {isIn ? "+" : "−"}
            <Money value={row.amount} compact />
          </span>
          <span
            className="mt-0.5 block text-[11px] font-semibold"
            style={{ color: row.state === "actual" ? "var(--color-ink-2)" : "var(--color-ink-3)" }}
          >
            {row.state === "actual" ? (isIn ? "已收" : "已付") : "預計"}
          </span>
        </span>
      </button>
    </li>
  );
}
