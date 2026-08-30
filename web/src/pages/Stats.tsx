/**
 * 統計（D52 第一期）——回答一個問題：**接新案前，公司的家底如何？**
 *
 *   產能：每個人、每種工作，一工做得出多少（經理＋系統管理員）
 *   成本：各品項越買越貴還是越便宜、每類流程平均一次花多少（有金額權限者）
 *
 * 資料全部由日常操作自動累積：員工按開始、當日回報＝產能；
 * 會計登應付款拆明細＝單價。這頁不用任何人多填東西。
 */
import { useMemo, useState } from "react";

import { useFlowCostStats, useProductivityStats, useUnitPriceStats } from "@/api/hooks";
import { useCurrentUser } from "@/api/hooks/useAuth";
import type { UnitPricePoint } from "@/api/types";
import { Card, EmptyState, Money, SectionTitle, Segmented, Spinner } from "@/components/ui";

const RANGES = [
  { value: "30", label: "近 30 天" },
  { value: "90", label: "近 90 天" },
  { value: "180", label: "近半年" },
  { value: "365", label: "近一年" },
];

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export default function Stats() {
  const { data: user } = useCurrentUser();
  const canProductivity = Boolean(user?.permissions.view_productivity);
  const canMoney = Boolean(user?.permissions.view_money);

  return (
    <div className="space-y-6">
      {canProductivity && <ProductivitySection />}
      {canMoney && <UnitPriceSection />}
      {canMoney && <FlowCostSection />}
    </div>
  );
}

// ── 產能 ────────────────────────────────────────────────────────────
function ProductivitySection() {
  const [range, setRange] = useState("90");
  const today = new Date().toISOString().slice(0, 10);
  const start = useMemo(() => isoDaysAgo(Number(range)), [range]);
  const { data, isLoading } = useProductivityStats(start, today);

  return (
    <section>
      <SectionTitle action={<Segmented value={range} onChange={setRange} options={RANGES} />}>
        產能
      </SectionTitle>
      <p className="-mt-1 mb-2 text-xs text-ink-3">
        一人一天＝1 工，記在當天有回報的分配上；同日多件均分。經理可在流程卡片上補登修正
      </p>

      {isLoading ? (
        <Spinner />
      ) : !data || data.company.length === 0 ? (
        <EmptyState
          title="這段期間還沒有回報紀錄"
          hint="員工在「我的任務」按開始、當日回報完成量，產能就會自動累積到這裡"
        />
      ) : (
        <>
          <Card className="mt-3 overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-3">
                  <th className="px-3 py-2 font-semibold">公司整體・工作類型</th>
                  <th className="px-3 py-2 text-right font-semibold">總量</th>
                  <th className="px-3 py-2 text-right font-semibold">工數</th>
                  <th className="px-3 py-2 text-right font-semibold">每工產出</th>
                  <th className="px-3 py-2 text-right font-semibold">逐月（量）</th>
                </tr>
              </thead>
              <tbody>
                {data.company.map((row) => (
                  <tr key={`${row.work_type}|${row.unit_of_measure}`} className="border-b border-line/60 last:border-0">
                    <td className="px-3 py-2 font-semibold text-ink">{row.work_type}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink">
                      {row.qty.toLocaleString("zh-TW")}
                      {row.unit_of_measure && ` ${row.unit_of_measure}`}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink">{row.man_days} 工</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink">
                      {row.per_man_day === null
                        ? "－"
                        : `${row.per_man_day.toLocaleString("zh-TW")}${row.unit_of_measure ? ` ${row.unit_of_measure}` : ""}／工`}
                    </td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums text-ink-3">
                      {row.monthly.map((m) => `${m.month.slice(5)}月 ${m.qty.toLocaleString("zh-TW")}`).join("　")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.people.map((p) => (
              <Card key={p.id} className="p-3">
                <div className="flex items-baseline justify-between">
                  <p className="text-sm font-bold text-ink">
                    {p.name}
                    {p.title && p.title !== p.name && (
                      <span className="ml-1.5 text-xs font-normal text-ink-3">{p.title}</span>
                    )}
                  </p>
                  <span className="text-xs tabular-nums text-ink-2">共 {p.man_days} 工</span>
                </div>
                <table className="mt-2 w-full text-xs">
                  <tbody>
                    {p.rows.map((row) => (
                      <tr key={`${row.work_type}|${row.unit_of_measure}`} className="border-t border-line/60">
                        <td className="py-1 text-ink-2">{row.work_type}</td>
                        <td className="py-1 text-right tabular-nums text-ink">
                          {row.qty.toLocaleString("zh-TW")}
                          {row.unit_of_measure && ` ${row.unit_of_measure}`}
                        </td>
                        <td className="py-1 text-right tabular-nums text-ink-3">{row.man_days} 工</td>
                        <td className="py-1 text-right tabular-nums text-ink">
                          {row.per_man_day === null ? "－" : `${row.per_man_day.toLocaleString("zh-TW")}／工`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

// ── 品項單價 ────────────────────────────────────────────────────────
function Sparkline({ points }: { points: UnitPricePoint[] }) {
  if (points.length < 2) return null;
  const w = 96;
  const h = 24;
  const prices = points.map((p) => p.unit_price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const d = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * (w - 4) + 2;
      const y = h - 3 - ((p.unit_price - min) / span) * (h - 6);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} aria-hidden className="shrink-0">
      <path d={d} fill="none" stroke="var(--color-stage-2)" strokeWidth={1.5} />
    </svg>
  );
}

function UnitPriceSection() {
  const { data, isLoading } = useUnitPriceStats();

  return (
    <section>
      <SectionTitle>材料單價</SectionTitle>
      <p className="-mt-1 mb-2 text-xs text-ink-3">
        登應付款時拆明細（品項×數量×單價），單價走勢就會累積到這裡
      </p>
      {isLoading ? (
        <Spinner />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          title="還沒有明細資料"
          hint="金流 → 應付：登錄計價時按「拆明細」填品項與數量，就能開始追蹤每噸／每支多少錢"
        />
      ) : (
        <Card className="mt-3 overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-3">
                <th className="px-3 py-2 font-semibold">品項</th>
                <th className="px-3 py-2 text-right font-semibold">採購次數</th>
                <th className="px-3 py-2 text-right font-semibold">累計數量</th>
                <th className="px-3 py-2 text-right font-semibold">平均單價</th>
                <th className="px-3 py-2 text-right font-semibold">最新單價</th>
                <th className="px-3 py-2 text-right font-semibold">走勢</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => {
                const up =
                  item.avg_price !== null && item.latest_price > item.avg_price;
                return (
                  <tr key={item.id} className="border-b border-line/60 last:border-0 align-middle">
                    <td className="px-3 py-2 font-semibold text-ink">
                      {item.name}
                      {item.unit_of_measure && (
                        <span className="ml-1 text-xs font-normal text-ink-3">
                          每{item.unit_of_measure}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-2">{item.count}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-2">
                      {item.total_qty.toLocaleString("zh-TW")}
                      {item.unit_of_measure && ` ${item.unit_of_measure}`}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink">
                      {item.avg_price === null ? "－" : <Money value={item.avg_price} />}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold"
                        style={{ color: up ? "var(--color-delayed)" : "var(--color-ontrack)" }}>
                      <Money value={item.latest_price} />
                      {item.avg_price !== null && item.count > 1 && (up ? " ↗" : " ↘")}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Sparkline points={item.points} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </section>
  );
}

// ── 每類流程花費 ────────────────────────────────────────────────────
function FlowCostSection() {
  const { data, isLoading } = useFlowCostStats();

  return (
    <section>
      <SectionTitle>每類流程平均花費</SectionTitle>
      <p className="-mt-1 mb-2 text-xs text-ink-3">
        應付款掛在流程單元上的合計（含未付——錢已承諾就是成本）。估新案時的參考價
      </p>
      {isLoading ? (
        <Spinner />
      ) : !data || data.rows.length === 0 ? (
        <EmptyState
          title="還沒有掛流程的應付款"
          hint="登應付款時選「花在哪個流程」，這裡就能算出每類流程平均一次花多少"
        />
      ) : (
        <Card className="mt-3 overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-3">
                <th className="px-3 py-2 font-semibold">流程</th>
                <th className="px-3 py-2 text-right font-semibold">案數</th>
                <th className="px-3 py-2 text-right font-semibold">平均一次</th>
                <th className="px-3 py-2 text-right font-semibold">合計</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.flow_name} className="border-b border-line/60 last:border-0">
                  <td className="px-3 py-2 font-semibold text-ink">{row.flow_name}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-2">{row.unit_count}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink">
                    <Money value={row.avg} /> 元
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-2">
                    <Money value={row.total} /> 元
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </section>
  );
}
