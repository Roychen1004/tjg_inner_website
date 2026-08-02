/**
 * 營運總覽
 *
 * 回答的問題：**公司現在整體狀況如何**。
 *
 * 版面順序就是重要性順序：
 *   KPI 卡片 → 需要關注（最有價值的一區）→ 各案進度 → 階段分布 → 最近動態
 *
 * 「需要關注」放在第二位不是隨便排的：一個管理者早上打開系統，
 * 想知道的不是「一切正常」，而是「哪裡不正常」。
 */
import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";

import { useActivities, useAttention, useDashboard } from "@/api/hooks";
import { useCurrentUser } from "@/api/hooks/useAuth";
import type { AttentionItem } from "@/api/types";
import {
  Card,
  EmptyState,
  ErrorState,
  KpiCard,
  Money,
  ProgressBar,
  SectionTitle,
  SeverityIcon,
  Spinner,
  StageTrack,
  StatusBadge,
} from "@/components/ui";

export default function Dashboard() {
  const { data: user } = useCurrentUser();
  const { data, isLoading, error, refetch } = useDashboard();
  const { data: attention } = useAttention();
  const { data: activities } = useActivities(12);

  if (isLoading) return <Spinner />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!data) return null;

  return (
    <div className="space-y-5">
      <section>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {data.cards.map((card) => (
            <KpiCard
              key={card.key}
              label={card.label}
              value={card.value}
              unit={card.unit}
              status={card.status}
              detail={card.detail}
            />
          ))}
        </div>
      </section>

      {/* 需要關注 —— 整個系統最有價值的一區 */}
      <section>
        <SectionTitle
          action={
            attention && attention.count > 0 ? (
              <span className="text-xs text-ink-3">
                延誤 {attention.by_severity.bad}、注意 {attention.by_severity.warn}
              </span>
            ) : undefined
          }
        >
          需要關注
        </SectionTitle>
        {!attention ? (
          <Spinner label="" />
        ) : attention.count === 0 ? (
          <EmptyState title="目前沒有需要處理的異常" hint="有東西卡住或逾期時會出現在這裡" />
        ) : (
          <Card>
            <ul className="divide-y divide-line">
              {attention.results.slice(0, 12).map((item, i) => (
                <AttentionRow key={`${item.type}-${i}`} item={item} />
              ))}
            </ul>
            {attention.count > 12 && (
              <p className="border-t border-line px-3 py-2 text-center text-xs text-ink-3">
                另有 {attention.count - 12} 項，請至各分頁查看
              </p>
            )}
          </Card>
        )}
      </section>

      <section>
        <SectionTitle
          action={
            <Link to="/projects" className="text-xs font-semibold text-stage-2">
              全部專案
            </Link>
          }
        >
          進行中專案
        </SectionTitle>
        {data.projects.length === 0 ? (
          <EmptyState title="目前沒有進行中的專案" />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {data.projects.map((project) => (
              <Card key={project.id} className="transition-base hover:ring-stage-2">
                {/* 點了直接到專案頁並展開那一案——看到問題就能馬上去處理，
                    不用自己再去專案頁找一次 */}
                <Link to={`/projects?open=${project.id}`} className="block p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-ink">{project.name}</p>
                    <p className="truncate text-[11px] text-ink-3">
                      {project.customer} · {project.code}
                    </p>
                  </div>
                  <StatusBadge status={project.status} size="xs" />
                </div>

                <div className="mt-2.5">
                  <StageTrack
                    current={project.stage_seq}
                    total={project.stage_total}
                    name={project.stage_name}
                  />
                </div>

                {data.can_view_amounts && project.collection_rate !== undefined && (
                  <div className="mt-2.5">
                    <ProgressBar
                      value={project.collection_rate}
                      label="收款進度"
                      compact
                      color="var(--color-ontrack)"
                    />
                    <p className="mt-1 text-[11px] text-ink-3">
                      已收 <Money value={project.received_amount} compact /> / 合約{" "}
                      <Money value={project.contract_amount} compact />
                    </p>
                  </div>
                )}

                <div className="mt-2 flex items-center gap-3 text-[11px] text-ink-2">
                  <span>{project.unit_count} 個追蹤單元</span>
                  {project.attention > 0 && (
                    <span style={{ color: "var(--color-atrisk)" }}>
                      {project.attention} 個需關注
                    </span>
                  )}
                  {project.is_overdue && (
                    <span style={{ color: "var(--color-delayed)" }}>已逾期</span>
                  )}
                  <ChevronRight size={13} className="ml-auto text-ink-3" />
                </div>
                </Link>
              </Card>
            ))}
          </div>
        )}
      </section>

      {data.by_stage.length > 0 && (
        <section>
          <SectionTitle>追蹤單元階段分布</SectionTitle>
          <div className="grid gap-2 sm:grid-cols-2">
            {data.by_stage.map((group) => (
              <Card key={group.template} className="p-3">
                <p className="mb-2 text-xs font-semibold text-ink-2">
                  {group.template}
                  <span className="ml-1 text-ink-3">共 {group.total} 筆</span>
                </p>
                <ul className="space-y-1.5">
                  {group.stages.map((stage) => (
                    <li key={stage.seq} className="flex items-center gap-2 text-xs">
                      <span className="w-20 shrink-0 truncate text-ink-2">{stage.name}</span>
                      <span className="h-3 flex-1 rounded bg-page">
                        <span
                          className="block h-full rounded"
                          style={{
                            width: `${(stage.count / group.total) * 100}%`,
                            background: stage.color,
                          }}
                        />
                      </span>
                      <span className="w-5 shrink-0 text-right font-semibold tabular-nums text-ink">
                        {stage.count}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionTitle>最近動態</SectionTitle>
        {!activities?.length ? (
          <EmptyState title="尚無動態" />
        ) : (
          <Card>
            <ul className="divide-y divide-line">
              {activities.map((activity) => (
                <li key={activity.id} className="flex gap-2 px-3 py-2 text-xs">
                  <span className="min-w-0 flex-1 text-ink">{activity.verb}</span>
                  <span className="shrink-0 text-ink-3">
                    {formatTime(activity.created_at)} · {activity.actor}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      {user && !user.permissions.view_amounts && (
        <p className="text-center text-[11px] text-ink-3">
          你的角色看不到金額欄位，顯示為 ──
        </p>
      )}
    </div>
  );
}

function AttentionRow({ item }: { item: AttentionItem }) {
  return (
    <li>
      <Link
        to={item.link}
        className="flex items-center gap-2.5 px-3 py-2.5 transition-base hover:bg-page"
      >
        <SeverityIcon severity={item.severity} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{item.title}</p>
          <p className="truncate text-xs text-ink-2">{item.reason}</p>
        </div>
        <span className="hidden shrink-0 text-xs font-semibold text-stage-2 sm:block">
          {item.action}
        </span>
        <ChevronRight size={15} className="shrink-0 text-ink-3" />
      </Link>
    </li>
  );
}

function formatTime(iso: string) {
  const date = new Date(iso);
  const diffMin = (Date.now() - date.getTime()) / 60000;
  if (diffMin < 60) return `${Math.max(1, Math.floor(diffMin))} 分鐘前`;
  if (diffMin < 60 * 24) return `${Math.floor(diffMin / 60)} 小時前`;
  return date.toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" });
}
