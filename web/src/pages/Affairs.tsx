/**
 * 行政（D53）
 *
 * 回答的問題：**公司非案子的事，什麼時候該做、誰做、做了沒**。
 * 繳網路費、打掃、報稅這類例行或臨時事務。
 *
 * 一個大日曆（月）為主，可切成條列。所有人都看得到，
 * 增刪改只有經理與系統管理員（edit_affairs）；被指派的員工可以勾完成。
 */
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  List,
  Plus,
  Repeat,
  Tags,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { useAffairRules, useAffairTasks } from "@/api/hooks";
import { useCurrentUser } from "@/api/hooks/useAuth";
import type { AffairRule, AffairTask } from "@/api/types";
import AffairTaskCard from "@/components/affairs/AffairTaskCard";
import AffairTaskForm from "@/components/affairs/AffairTaskForm";
import CategoryManager from "@/components/affairs/CategoryManager";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Modal,
  SectionTitle,
  Segmented,
  Spinner,
} from "@/components/ui";

const WEEK_HEADS = ["日", "一", "二", "三", "四", "五", "六"];

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export default function Affairs() {
  const { data: user } = useCurrentUser();
  const canEdit = Boolean(user?.permissions.edit_affairs);
  const [params] = useSearchParams();
  const [view, setView] = useState<"calendar" | "list">("calendar");
  // 顯示中的月份（每月一日）——通知的連結帶 ?date= 就跳到那個月
  const [month, setMonth] = useState(() => {
    const seed = params.get("date");
    const d = seed ? new Date(seed) : new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [formOpen, setFormOpen] = useState(false);
  // 點事項＝開卡片看內容／傳檔案／回報完成（D53 第二版：不再在格子上直接打勾）
  const [cardTask, setCardTask] = useState<AffairTask | null>(null);
  const [editingTask, setEditingTask] = useState<AffairTask | null>(null);
  const [editingRule, setEditingRule] = useState<AffairRule | null>(null);
  const [pickedDate, setPickedDate] = useState<string | undefined>();
  const [showCategories, setShowCategories] = useState(false);
  const [showRules, setShowRules] = useState(false);

  // 日曆要連前後補滿的格子一起抓；
  // 條列往前多看 14 天——繳費這種事逾期最要緊，跨月了也要看得到
  const gridStart = useMemo(() => {
    const d = new Date(month);
    d.setDate(1 - d.getDay());
    return d;
  }, [month]);
  const listStart = useMemo(() => {
    const d = new Date(month);
    d.setDate(d.getDate() - 14);
    return d;
  }, [month]);
  const rangeStart = view === "calendar" ? iso(gridStart) : iso(listStart);
  const rangeEnd = useMemo(() => {
    if (view === "calendar") {
      const d = new Date(gridStart);
      d.setDate(d.getDate() + 41);   // 六列 × 七天
      return iso(d);
    }
    const d = new Date(month.getFullYear(), month.getMonth() + 2, 0);
    return iso(d);
  }, [view, gridStart, month]);

  const { data, isLoading, error, refetch } = useAffairTasks(rangeStart, rangeEnd);
  const rules = useAffairRules();

  // 這段期間的完成狀況——老闆要求「勾完成不算工，但要讓經理看得到」
  const summary = useMemo(() => {
    const list = data ?? [];
    return {
      total: list.length,
      done: list.filter((t) => t.is_done).length,
      overdue: list.filter((t) => t.is_overdue).length,
      unassigned: list.filter((t) => t.assignees.length === 0).length,
    };
  }, [data]);

  const byDate = useMemo(() => {
    const map = new Map<string, AffairTask[]>();
    for (const t of data ?? []) {
      const list = map.get(t.date);
      if (list) list.push(t);
      else map.set(t.date, [t]);
    }
    return map;
  }, [data]);

  function openNew(date?: string) {
    setEditingTask(null);
    setEditingRule(null);
    setPickedDate(date);
    setFormOpen(true);
  }

  /** 點事項＝開卡片（看內容、傳檔案、回報完成） */
  function openTask(task: AffairTask) {
    setCardTask(task);
  }

  /** 卡片裡按「修改內容」才進表單 */
  function editTask(task: AffairTask) {
    setCardTask(null);
    setEditingTask(task);
    setEditingRule(null);
    setPickedDate(undefined);
    setFormOpen(true);
  }

  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const monthLabel = `${month.getFullYear()} 年 ${month.getMonth() + 1} 月`;

  return (
    <div className="space-y-4">
      {/* 一列工具列：月份切換｜檢視切換｜管理 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="上個月"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            className="rounded-lg border border-line bg-card p-2 text-ink-2 transition-base hover:bg-page"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="min-w-32 text-center text-base font-bold tabular-nums text-ink">
            {monthLabel}
          </span>
          <button
            type="button"
            aria-label="下個月"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            className="rounded-lg border border-line bg-card p-2 text-ink-2 transition-base hover:bg-page"
          >
            <ChevronRight size={16} />
          </button>
          <button
            type="button"
            onClick={() => {
              const now = new Date();
              setMonth(new Date(now.getFullYear(), now.getMonth(), 1));
            }}
            className="rounded-lg border border-line bg-card px-3 py-2 text-sm font-semibold text-ink-2 transition-base hover:bg-page"
          >
            今天
          </button>
        </div>

        <Segmented
          value={view}
          onChange={(v) => setView(v as "calendar" | "list")}
          options={[
            { value: "calendar", label: <><CalendarDays size={14} /> 日曆</> },
            { value: "list", label: <><List size={14} /> 條列</> },
          ]}
        />

        {canEdit && (
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setShowRules(true)}>
              <Repeat size={14} />
              例行事項
              {rules.data?.length ? (
                <span className="ml-1 tabular-nums text-ink-3">{rules.data.length}</span>
              ) : null}
            </Button>
            <Button variant="ghost" onClick={() => setShowCategories(true)}>
              <Tags size={14} />
              類別
            </Button>
            <Button variant="primary" onClick={() => openNew()}>
              <Plus size={14} />
              新增事項
            </Button>
          </div>
        )}
      </div>

      {!isLoading && summary.total > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="text-ink-2">
            這段期間<span className="ml-1 font-bold tabular-nums text-ink">{summary.total}</span> 件
          </span>
          <span style={{ color: "var(--color-ontrack)" }}>
            已完成 <span className="font-bold tabular-nums">{summary.done}</span>
          </span>
          {summary.overdue > 0 && (
            <span style={{ color: "var(--color-delayed)" }}>
              逾期未做 <span className="font-bold tabular-nums">{summary.overdue}</span>
            </span>
          )}
          {summary.unassigned > 0 && canEdit && (
            <span className="text-ink-3">
              未指派 <span className="font-bold tabular-nums">{summary.unassigned}</span>
            </span>
          )}
        </div>
      )}

      {isLoading ? (
        <Spinner />
      ) : view === "calendar" ? (
        <CalendarGrid
          gridStart={gridStart}
          month={month}
          byDate={byDate}
          canEdit={canEdit}
          onNew={openNew}
          onOpen={openTask}
        />
      ) : (
        <ListView tasks={data ?? []} canEdit={canEdit} onOpen={openTask} />
      )}

      {cardTask && (
        <AffairTaskCard
          task={
            // 完成後列表會重抓，用最新的那份資料，不是點下去當時的快照
            (data ?? []).find((t) => t.id === cardTask.id) ?? cardTask
          }
          open
          onClose={() => setCardTask(null)}
          onEdit={canEdit ? () => editTask(cardTask) : undefined}
        />
      )}

      {formOpen && (
        <AffairTaskForm
          open={formOpen}
          onClose={() => setFormOpen(false)}
          task={editingTask}
          rule={editingRule}
          defaultDate={pickedDate}
        />
      )}
      {showCategories && (
        <CategoryManager open={showCategories} onClose={() => setShowCategories(false)} />
      )}
      {showRules && (
        <RuleList
          open={showRules}
          onClose={() => setShowRules(false)}
          rules={rules.data ?? []}
          onEdit={(rule) => {
            setShowRules(false);
            setEditingTask(null);
            setEditingRule(rule);
            setPickedDate(undefined);
            setFormOpen(true);
          }}
        />
      )}
    </div>
  );
}

/** 大月曆：六列 × 七天，格子裡列當天的事項 */
function CalendarGrid({
  gridStart,
  month,
  byDate,
  canEdit,
  onNew,
  onOpen,
}: {
  gridStart: Date;
  month: Date;
  byDate: Map<string, AffairTask[]>;
  canEdit: boolean;
  onNew: (date: string) => void;
  onOpen: (t: AffairTask) => void;
}) {
  const todayIso = iso(new Date());
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  return (
    <Card className="overflow-hidden p-0">
      <div className="grid grid-cols-7 border-b border-line bg-page">
        {WEEK_HEADS.map((w) => (
          <div key={w} className="py-2 text-center text-xs font-bold text-ink-2">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((d) => {
          const key = iso(d);
          const items = byDate.get(key) ?? [];
          const inMonth = d.getMonth() === month.getMonth();
          const isToday = key === todayIso;
          return (
            <div
              key={key}
              className="min-h-24 border-b border-r border-line p-1 last:border-r-0 sm:min-h-28"
              style={{ background: inMonth ? undefined : "var(--color-page)" }}
            >
              <div className="mb-1 flex items-center justify-between">
                <span
                  className={[
                    "inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1",
                    "text-xs font-bold tabular-nums",
                    isToday ? "text-white" : inMonth ? "text-ink" : "text-ink-3",
                  ].join(" ")}
                  style={isToday ? { background: "var(--color-stage-2)" } : undefined}
                >
                  {d.getDate()}
                </span>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => onNew(key)}
                    aria-label={`在 ${key} 新增事項`}
                    className="rounded p-0.5 text-ink-3 opacity-0 transition-base hover:bg-page focus:opacity-100 group-hover:opacity-100 sm:opacity-60"
                  >
                    <Plus size={13} />
                  </button>
                )}
              </div>
              <ul className="space-y-1">
                {items.map((t) => (
                  <li key={t.id}>
                    <DayChip task={t} onOpen={() => onOpen(t)} />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/** 日曆格子裡的一條事項：左邊小記號是狀態（不是按鈕），點整條開卡片 */
function DayChip({ task, onOpen }: { task: AffairTask; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] leading-tight transition-base hover:brightness-95"
      style={{
        background: task.is_done ? "var(--color-page)" : `${task.category_color}1a`,
        opacity: task.is_done ? 0.65 : 1,
      }}
      title={[
        task.title,
        task.assignee_names.length ? `（${task.assignee_names.join("、")}）` : "",
        task.is_done && task.done_by_name ? `　✓ ${task.done_by_name} 已完成` : "",
      ].join("")}
    >
      <span
        aria-hidden
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded border"
        style={{
          borderColor: task.is_done ? "var(--color-ontrack)" : task.category_color,
          background: task.is_done ? "var(--color-ontrack)" : "transparent",
        }}
      >
        {task.is_done && <Check size={11} className="text-white" />}
      </span>
      <span
        className="min-w-0 flex-1 truncate font-semibold text-ink"
        style={{
          textDecoration: task.is_done ? "line-through" : undefined,
          color: task.is_overdue ? "var(--color-delayed)" : undefined,
        }}
      >
        {task.title}
      </span>
    </button>
  );
}

/** 條列檢視：本月起兩個月（往前多看 14 天），依日期分群 */
function ListView({
  tasks,
  canEdit,
  onOpen,
}: {
  tasks: AffairTask[];
  canEdit: boolean;
  onOpen: (t: AffairTask) => void;
}) {
  if (tasks.length === 0) {
    return (
      <EmptyState
        title="這段期間沒有行政事項"
        hint={canEdit ? "按右上角「新增事項」建立臨時或例行的待辦" : "經理建立之後會出現在這裡"}
      />
    );
  }
  const groups = new Map<string, AffairTask[]>();
  for (const t of tasks) {
    const list = groups.get(t.date);
    if (list) list.push(t);
    else groups.set(t.date, [t]);
  }
  const todayIso = iso(new Date());

  return (
    <div className="space-y-4">
      {[...groups.entries()].map(([date, items]) => (
        <section key={date}>
          <SectionTitle>
            <span style={date === todayIso ? { color: "var(--color-stage-2)" } : undefined}>
              {date}
              {date === todayIso && "（今天）"}
              <span className="ml-1.5 text-xs font-normal text-ink-3">{items.length} 件</span>
            </span>
          </SectionTitle>
          <ul className="space-y-2">
            {items.map((t) => (
              <Card as="li" key={t.id} className="p-0">
                <button
                  type="button"
                  onClick={() => onOpen(t)}
                  className="flex w-full items-center gap-2 p-3 text-left transition-base hover:bg-page"
                >
                  <span
                    aria-hidden
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2"
                    style={{
                      borderColor: t.is_done ? "var(--color-ontrack)" : t.category_color,
                      background: t.is_done ? "var(--color-ontrack)" : "transparent",
                    }}
                  >
                    {t.is_done && <Check size={14} className="text-white" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span
                        className="text-sm font-bold text-ink"
                        style={{ textDecoration: t.is_done ? "line-through" : undefined }}
                      >
                        {t.title}
                      </span>
                      <span
                        className="rounded-full px-2 py-0.5 text-xs font-semibold"
                        style={{ background: `${t.category_color}1a`, color: t.category_color }}
                      >
                        {t.category_name}
                      </span>
                      {t.rule_text && (
                        <span className="inline-flex items-center gap-0.5 text-xs text-ink-3">
                          <Repeat size={11} />
                          {t.rule_text}
                        </span>
                      )}
                      {t.is_overdue && (
                        <span className="text-xs font-bold" style={{ color: "var(--color-delayed)" }}>
                          逾期
                        </span>
                      )}
                      {/* D55：有金額的行政事項也是公司的錢
                          D56：參考金額是預估，灰字加「參考」二字跟真的錢分開 */}
                      {Number(t.amount) > 0 && (
                        <span
                          className="text-xs font-bold tabular-nums"
                          style={{
                            color: t.is_reference
                              ? "var(--color-ink-3)"
                              : t.direction === "in"
                                ? "var(--color-ontrack)"
                                : "var(--color-delayed)",
                          }}
                        >
                          {t.is_reference ? "參考 " : t.direction === "in" ? "+" : "−"}
                          {Number(t.amount).toLocaleString("zh-TW")}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-ink-3">
                      {t.assignee_names.length ? t.assignee_names.join("、") : "未指派"}
                      {t.is_done && t.done_by_name && `　✓ ${t.done_by_name} 已完成`}
                      {t.note && `　${t.note}`}
                    </span>
                  </span>
                  <ChevronRight size={15} className="shrink-0 text-ink-3" />
                </button>
              </Card>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** 例行事項清單：看目前有哪些重複規則，點進去改整條 */
function RuleList({
  open,
  onClose,
  rules,
  onEdit,
}: {
  open: boolean;
  onClose: () => void;
  rules: AffairRule[];
  onEdit: (rule: AffairRule) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="例行事項">
      {rules.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-3">
          還沒有例行事項。新增事項時選「例行（重複）」就會列在這裡。
        </p>
      ) : (
        <ul className="space-y-2">
          {rules.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onEdit(r)}
                className="w-full rounded-lg border border-line px-3 py-2 text-left transition-base hover:bg-page"
              >
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-bold text-ink">{r.title}</span>
                  <span
                    className="rounded-full px-2 py-0.5 text-xs font-semibold"
                    style={{ background: `${r.category_color}1a`, color: r.category_color }}
                  >
                    {r.category_name}
                  </span>
                  <span className="text-xs font-semibold text-ink-2">{r.freq_text}</span>
                  {Number(r.amount) > 0 && (
                    <span
                      className="text-xs font-bold tabular-nums"
                      style={{
                        color: r.is_reference
                          ? "var(--color-ink-3)"
                          : r.direction === "in"
                            ? "var(--color-ontrack)"
                            : "var(--color-delayed)",
                      }}
                    >
                      每次 {r.is_reference ? "參考 " : r.direction === "in" ? "+" : "−"}
                      {Number(r.amount).toLocaleString("zh-TW")}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block truncate text-xs text-ink-3">
                  {r.assignee_names.length ? r.assignee_names.join("、") : "未指派"}
                  {r.end_date && `　至 ${r.end_date} 止`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
