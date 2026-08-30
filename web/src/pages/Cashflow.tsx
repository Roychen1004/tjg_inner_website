/**
 * 現金流預測
 *
 * **這個畫面只回答一個問題：未來哪個月會缺錢？**
 *
 * 所以版面的重心是那條「累計」列，以及它跌破零的第一格。
 * 其餘所有東西——收入、支出、確定性、明細——都是為了讓那一格可信。
 *
 * 三個讓它可信的設計：
 *   ① 確定性可以切換。只看「確定」＝最壞情況，那才是真正有用的模式
 *   ② 每一格點得進去看是哪幾筆組成的。沒有明細的總數沒有人敢信
 *   ③ 底部固定寫著「這是專案現金流，不含薪資租金水電」——
 *      不寫的話，看的人會以為累計是正的就沒事
 */
import { AlertTriangle, Info } from "lucide-react";
import { useState } from "react";

import { ApiError } from "@/api/client";
import { useCashBalance, useCashflow, useOptions, useSaveCashBalance } from "@/api/hooks";
import { useCurrentUser } from "@/api/hooks/useAuth";
import type { CashflowCell, Certainty } from "@/api/types";
import CashflowTimeline from "@/components/billing/CashflowTimeline";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Modal,
  Money,
  Segmented,
  Select,
  Spinner,
} from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { useStickyParams } from "@/lib/stickyParams";

const CERTAINTY_ORDER: Certainty[] = ["confirmed", "likely", "estimated"];
const KEYS = ["granularity", "periods", "certainty", "project", "cfview"];

export default function Cashflow() {
  const { data: options } = useOptions();
  const { data: user } = useCurrentUser();
  const [searchParams, setSearchParams] = useStickyParams("cashflow.filters", KEYS);
  const granularity = (searchParams.get("granularity") as "week" | "month") ?? "week";
  const periods = searchParams.get("periods") ?? (granularity === "week" ? "12" : "6");
  const certainty = searchParams.get("certainty") ?? "";
  const project = searchParams.get("project") ?? "";
  // D49：表格｜時間軸 兩種看法
  const view = searchParams.get("cfview") === "timeline" ? "timeline" : "table";
  const [drill, setDrill] = useState<CashflowCell | null>(null);

  const setParam = (name: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(name, value);
    else next.delete(name);
    // 切換週／月時期數要跟著換，否則會拿 12 個月（超過上限被截）
    if (name === "granularity") next.set("periods", value === "week" ? "12" : "6");
    setSearchParams(next, { replace: true });
  };

  const tableQuery = useCashflow(
    {
      granularity,
      periods,
      certainty: certainty || undefined,
      project: project || undefined,
    },
    view === "table",
  );
  // 時間軸固定抓 24 個月（月粒度）——縮放平移在前端做，不用重打 API
  const timelineQuery = useCashflow(
    {
      granularity: "month",
      periods: "24",
      certainty: certainty || undefined,
      project: project || undefined,
    },
    view === "timeline",
  );
  const { data, isLoading, error, refetch } =
    view === "timeline" ? timelineQuery : tableQuery;

  if (isLoading) return <Spinner label="計算現金流…" />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!data) return <EmptyState title="沒有資料" />;

  const cells = data.cells;
  const hasMoney = cells.some((c) => Number(c.income) || Number(c.expense));
  const canEditCash = Boolean(user?.permissions.view_cash_balance);

  return (
    <div className="space-y-4">
      {/* ★ 整個畫面的結論。放最上面，因為那才是使用者來這裡要看的東西 */}
      {data.shortfall ? (
        <Card
          className="flex items-start gap-3 p-4"
          style={{ background: "var(--color-delayed-bg)" }}
        >
          <AlertTriangle size={20} className="mt-0.5 shrink-0" style={{ color: "var(--color-delayed)" }} />
          <div>
            <p className="text-sm font-bold" style={{ color: "var(--color-delayed)" }}>
              {data.shortfall.label}會缺 <Money value={data.shortfall.amount} compact /> 元
            </p>
            <p className="mt-1 text-xs leading-relaxed text-ink-2">
              {data.opening_balance !== null
                ? "累計已含公司現有現金——到那一格，帳上的錢是真的不夠付。"
                : "到那一格為止，收進來的錢不夠付出去的。"}
              現在還來得及：把可請款的單開出去、或跟業主談提前撥款、或把可以延的付款往後排。
            </p>
          </div>
        </Card>
      ) : hasMoney ? (
        <Card className="flex items-start gap-3 p-4" style={{ background: "var(--color-ontrack-bg)" }}>
          <Info size={20} className="mt-0.5 shrink-0" style={{ color: "var(--color-ontrack)" }} />
          <div>
            <p className="text-sm font-bold" style={{ color: "var(--color-ontrack)" }}>
              這段期間累計都是正的
            </p>
            <p className="mt-1 text-xs leading-relaxed text-ink-2">
              專案現金流沒有缺口。但這不含每月固定支出——見畫面底部的說明。
            </p>
          </div>
        </Card>
      ) : null}

      {/* 公司現有現金（D49）——只有經理與系統管理員看得到這一塊 */}
      {canEditCash && <CashBalanceCard />}

      <section className="flex flex-wrap items-center gap-2">
        {/* 表格｜時間軸（D49），邊界標示（D50） */}
        <Segmented
          value={view}
          onChange={(v) => setParam("cfview", v === "table" ? "" : v)}
          options={[
            { value: "table", label: "表格" },
            { value: "timeline", label: "時間軸" },
          ]}
        />
        {view === "table" && (
          <>
            <Select
              value={granularity}
              onChange={(v) => setParam("granularity", v)}
              options={[
                { value: "week", label: "以週看" },
                { value: "month", label: "以月看" },
              ]}
            />
            <Select
              value={periods}
              onChange={(v) => setParam("periods", v)}
              options={
                granularity === "week"
                  ? [
                      { value: "8", label: "未來 8 週" },
                      { value: "12", label: "未來 12 週" },
                      { value: "26", label: "未來 26 週" },
                    ]
                  : [
                      { value: "6", label: "未來 6 個月" },
                      { value: "12", label: "未來 12 個月" },
                      { value: "24", label: "未來 24 個月" },
                    ]
              }
            />
          </>
        )}
        <Select
          value={certainty}
          onChange={(v) => setParam("certainty", v)}
          options={[
            { value: "confirmed", label: "只看確定的（最壞情況）" },
            { value: "confirmed,likely", label: "確定＋很可能" },
          ]}
          placeholder="全部（含預估）"
        />
        <Select
          value={project}
          onChange={(v) => setParam("project", v)}
          options={(options?.projects ?? []).map((p) => ({ value: p.id, label: p.name }))}
          placeholder="全部專案"
        />
      </section>

      {!hasMoney ? (
        <EmptyState
          title="這段期間沒有預計的收付"
          hint="收入來自請款事件與填了「預計可請款日」的里程碑；支出來自應付款項與分包合約。都沒有的話，這張表就是空的——不是系統壞了，是還沒有資料"
        />
      ) : view === "timeline" ? (
        <CashflowTimeline data={data} />
      ) : (
        <>
          {data.opening_balance !== null && (
            <p className="text-xs text-ink-2">
              「累計」列從公司現有現金 <Money value={data.opening_balance} compact /> 元起算。
            </p>
          )}
          <Table cells={cells} onDrill={setDrill} />
        </>
      )}

      <section className="grid gap-2 sm:grid-cols-3">
        <Total label="期間總收入" value={data.totals.income} />
        <Total label="期間總支出" value={data.totals.expense} negative />
        <Total label="期間淨額" value={data.totals.net} />
      </section>

      {/* 落在窗外的錢。不講的話，會以為總額就是全部 */}
      {(Number(data.outside_window.income) > 0 || Number(data.outside_window.expense) > 0) && (
        <p className="rounded-lg bg-page px-3 py-2 text-xs leading-relaxed text-ink-2">
          另有落在這段期間之外的：收入 <Money value={data.outside_window.income} compact /> 元、
          支出 <Money value={data.outside_window.expense} compact /> 元。
          把期間拉長才看得到它們。
        </p>
      )}

      {/* ⚠️ 固定顯示，不可收合 */}
      <div
        className="flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs leading-relaxed"
        style={{ background: "var(--color-atrisk-bg)", color: "var(--color-atrisk)" }}
      >
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        <div>
          <p className="font-semibold">
            這是專案現金流，不含薪資、租金、水電等固定支出。
          </p>
          <p className="mt-0.5 opacity-90">
            公司整體現金部位請再扣掉每月固定成本。{data.tax_note}
          </p>
        </div>
      </div>

      {drill && <CellDetail cell={drill} onClose={() => setDrill(null)} />}
    </div>
  );
}

/**
 * 公司現有現金（D49）——**只有經理與系統管理員看得到**（會計師也看不到）。
 * 填進來的數字直接成為「累計」列的起點：跌破零＝現金真的見底。
 */
function CashBalanceCard() {
  const { data } = useCashBalance(true);
  const save = useSaveCashBalance();
  const toast = useToast();
  const [draft, setDraft] = useState<string | null>(null);

  const value = draft ?? (data ? String(Number(data.amount)) : "");
  const dirty = data !== undefined && draft !== null && Number(draft) !== Number(data.amount);

  function submit() {
    if (!dirty || draft === null || draft.trim() === "") return;
    save.mutate(
      { amount: draft.trim() },
      {
        onSuccess: () => {
          setDraft(null);
          toast.success("公司現有現金已更新", ["累計列會從這個數字起算"]);
        },
        onError: (e) =>
          toast.error(e instanceof ApiError ? e.body.detail ?? "儲存失敗" : "儲存失敗"),
      },
    );
  }

  return (
    <Card className="flex flex-wrap items-center gap-3 p-3">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-ink-2">公司現有現金（僅經理與系統管理員看得到）</p>
        <p className="mt-0.5 text-xs text-ink-3">
          {data?.updated_by_name
            ? `上次更新：${new Date(data.updated_at).toLocaleString("zh-TW")}·${data.updated_by_name}`
            : "填入目前帳上的現金，累計列會從這個數字起算"}
        </p>
      </div>
      <div className="ml-auto flex items-center gap-1.5">
        <input
          type="number"
          inputMode="decimal"
          value={value}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          aria-label="公司現有現金"
          className="w-36 rounded-lg border border-line bg-page px-2 py-1.5 text-right text-sm font-bold tabular-nums text-ink"
        />
        <span className="text-xs text-ink-3">元</span>
        <Button variant="primary" onClick={submit} loading={save.isPending} disabled={!dirty}>
          儲存
        </Button>
      </div>
    </Card>
  );
}

function Table({
  cells,
  onDrill,
}: {
  cells: CashflowCell[];
  onDrill: (cell: CashflowCell) => void;
}) {
  return (
    // 手機用橫向捲動看時間軸——擠成一欄反而看不出趨勢
    <div className="overflow-x-auto rounded-xl bg-card ring-1 ring-line">
      <table className="w-full min-w-max text-right text-xs tabular-nums">
        <thead>
          <tr className="border-b border-line">
            <th className="sticky left-0 bg-card px-3 py-2 text-left font-semibold text-ink-2">
              期間
            </th>
            {cells.map((cell) => (
              <th key={cell.key} className="px-3 py-2 font-semibold text-ink-2">
                {cell.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <Line label="收入" cells={cells} pick={(c) => c.income} tone="in" />
          {CERTAINTY_ORDER.map((level) => (
            <SubLine
              key={level}
              level={level}
              cells={cells}
              pick={(c) => c.income_by_certainty[level]}
            />
          ))}
          <Line label="支出" cells={cells} pick={(c) => `-${c.expense}`} tone="out" />
          {CERTAINTY_ORDER.map((level) => (
            <SubLine
              key={level}
              level={level}
              cells={cells}
              pick={(c) => c.expense_by_certainty[level]}
              negative
            />
          ))}

          <tr className="border-t border-line">
            <th className="sticky left-0 bg-card px-3 py-2 text-left font-bold text-ink">淨額</th>
            {cells.map((cell) => (
              <td key={cell.key} className="px-3 py-2 font-semibold text-ink">
                <Signed value={cell.net} />
              </td>
            ))}
          </tr>
          {/* ★ 這一列是重點。累計為負的那格要一眼看得出來 */}
          <tr className="border-t-2 border-line bg-page">
            <th className="sticky left-0 bg-page px-3 py-2 text-left font-bold text-ink">累計</th>
            {cells.map((cell) => {
              const short = Number(cell.cumulative) < 0;
              return (
                <td
                  key={cell.key}
                  className="px-3 py-2 font-bold"
                  style={
                    short
                      ? { color: "var(--color-delayed)", background: "var(--color-delayed-bg)" }
                      : undefined
                  }
                >
                  {short && <AlertTriangle size={11} className="mr-0.5 inline" aria-hidden />}
                  <Signed value={cell.cumulative} />
                </td>
              );
            })}
          </tr>
          <tr>
            <td className="sticky left-0 bg-card px-3 py-1.5" />
            {cells.map((cell) => (
              <td key={cell.key} className="px-3 py-1.5">
                {cell.detail_count > 0 && (
                  <button
                    type="button"
                    onClick={() => onDrill(cell)}
                    className="text-xs font-semibold text-ink-2 underline underline-offset-2"
                  >
                    {cell.detail_count} 筆
                  </button>
                )}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Line({
  label,
  cells,
  pick,
  tone,
}: {
  label: string;
  cells: CashflowCell[];
  pick: (cell: CashflowCell) => string;
  tone: "in" | "out";
}) {
  return (
    <tr className="border-t border-line">
      <th className="sticky left-0 bg-card px-3 py-2 text-left font-semibold text-ink">{label}</th>
      {cells.map((cell) => {
        const value = Number(pick(cell));
        return (
          <td
            key={cell.key}
            className="px-3 py-2 font-semibold"
            style={{
              color: value
                ? tone === "in"
                  ? "var(--color-ontrack)"
                  : "var(--color-delayed)"
                : "var(--color-ink-3)",
            }}
          >
            {value ? <Money value={value} compact /> : "—"}
          </td>
        );
      })}
    </tr>
  );
}

const CERTAINTY_LABEL: Record<Certainty, string> = {
  confirmed: "確定",
  likely: "很可能",
  estimated: "預估",
};

function SubLine({
  level,
  cells,
  pick,
  negative = false,
}: {
  level: Certainty;
  cells: CashflowCell[];
  pick: (cell: CashflowCell) => string | undefined;
  negative?: boolean;
}) {
  const values = cells.map((c) => Number(pick(c) ?? 0));
  // 整列都是 0 就不佔一行——空列會讓表變高而沒有帶來任何資訊
  if (values.every((v) => !v)) return null;
  return (
    <tr>
      <th className="sticky left-0 bg-card py-1 pl-6 pr-3 text-left text-xs font-normal text-ink-3">
        {CERTAINTY_LABEL[level]}
      </th>
      {values.map((value, i) => (
        <td key={cells[i].key} className="px-3 py-1 text-xs text-ink-3">
          {value ? (
            <>
              {negative && "-"}
              <Money value={value} compact />
            </>
          ) : (
            "—"
          )}
        </td>
      ))}
    </tr>
  );
}

function Signed({ value }: { value: string }) {
  const num = Number(value);
  return (
    <>
      {num > 0 && "+"}
      {num < 0 && "-"}
      <Money value={Math.abs(num)} compact />
    </>
  );
}

function Total({ label, value, negative }: { label: string; value: string; negative?: boolean }) {
  return (
    <Card className="p-3">
      <p className="text-xs font-semibold text-ink-2">{label}</p>
      <p
        className="mt-1 text-xl font-bold tabular-nums"
        style={{ color: negative ? "var(--color-delayed)" : "var(--color-ink)" }}
      >
        {negative && "-"}
        <Money value={value} compact /> <span className="text-xs font-normal text-ink-3">元</span>
      </p>
    </Card>
  );
}

function CellDetail({ cell, onClose }: { cell: CashflowCell; onClose: () => void }) {
  const income = cell.details.filter((d) => d.direction === "in");
  const expense = cell.details.filter((d) => d.direction === "out");
  return (
    <Modal open onClose={onClose} title={`${cell.label}（${cell.start} ~ ${cell.end}）`}>
      <Group title="收入" rows={income} tone="in" />
      <Group title="支出" rows={expense} tone="out" />
    </Modal>
  );
}

function Group({
  title,
  rows,
  tone,
}: {
  title: string;
  rows: CashflowCell["details"];
  tone: "in" | "out";
}) {
  if (!rows.length) return null;
  const total = rows.reduce((sum, r) => sum + Number(r.amount), 0);
  return (
    <section className="mb-4">
      <div className="mb-1.5 flex items-baseline justify-between">
        <h4 className="text-sm font-bold text-ink">{title}</h4>
        <p
          className="text-sm font-bold tabular-nums"
          style={{ color: tone === "in" ? "var(--color-ontrack)" : "var(--color-delayed)" }}
        >
          {tone === "out" && "-"}
          <Money value={total} compact /> 元
        </p>
      </div>
      <ul className="divide-y divide-line rounded-lg ring-1 ring-line">
        {rows.map((row) => (
          <li key={`${row.kind}-${row.id}`} className="px-3 py-2">
            <div className="flex items-baseline justify-between gap-2">
              <p className="truncate text-xs font-semibold text-ink">
                {row.party}　{row.title}
              </p>
              <p className="shrink-0 text-xs font-semibold tabular-nums text-ink">
                {tone === "out" && "-"}
                <Money value={row.amount} compact />
              </p>
            </div>
            <p className="mt-0.5 text-xs text-ink-3">
              {row.project} · {row.date} · {CERTAINTY_LABEL[row.certainty]} · {row.note}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
