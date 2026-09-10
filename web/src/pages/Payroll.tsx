/**
 * 薪資（D57）
 *
 * 只有經理、會計師與系統管理員看得到（後端 view_payroll 決定分頁存不存在）。
 *
 * 三個分頁，各回答一個問題：
 *   月薪資　　這個月每個人領多少、怎麼算出來的
 *   員工設定　每個人的時薪與投保級距（每月不變的部分）
 *   法規參數　最低工資、加班倍率、勞健保費率（每年會變的部分）
 *
 * ★ 設計原則：**畫面上沒有一個算出來的數字是不能追溯的。**
 *   每張薪資單都把每一行的算式攤開（「10 小時 × 196 × 1.34 ＝ 2,626」），
 *   因為會計師現在是拿計算機對打卡表——只給總額她不會信，
 *   最後還是會自己再算一次，那這頁就白做了。
 *
 * ★ 而且**每個會變的數字都是輸入格**：法規每年調、每個人的狀況都不一樣，
 *   寫死在程式裡等於每次修法都要重新部署，而那會拖到她發薪水。
 */
import {
  AlertTriangle,
  Calculator,
  Check,
  Download,
  ExternalLink,
  Lock,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";

import {
  Button,
  Card,
  DateInput,
  EmptyState,
  ErrorState,
  Field,
  Modal,
  SectionTitle,
  Segmented,
  Select,
  Spinner,
  inputClass,
} from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import type {
  CalcRow,
  CalendarDay,
  DayKind,
  PayrollPeriod,
  PayrollRecord,
  SalaryProfile,
} from "@/api/hooks/usePayroll";
import {
  useCreatePeriod,
  useDeleteHoliday,
  useDeleteLine,
  useHolidays,
  useImportHolidays,
  useInsuranceGrades,
  usePayrollPeriods,
  usePayrollPolicy,
  usePayrollRecords,
  usePayrollReferences,
  usePeriodAction,
  usePeriodSuggestion,
  useSaveHoliday,
  useSaveLine,
  useSavePeriod,
  useSavePolicy,
  useSaveProfile,
  useSaveRecord,
  useSalaryProfiles,
  useSyncProfiles,
} from "@/api/hooks/usePayroll";

/** 金額：一律整數、千分位。薪資單上不會出現 0.5 元 */
function nt(value: string | number | null | undefined) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toLocaleString("zh-TW", { maximumFractionDigits: 0 }) : "—";
}

/** 時數：去掉沒有意義的小數 0（10.00 → 10、10.50 → 10.5） */
function hrs(value: string | number | null | undefined) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? String(Number(n.toFixed(2))) : "—";
}

// ── 可編輯的數字格 ─────────────────────────────────────────────────
// 自己保留輸入中的字串，不要每打一個字就往上送——那會在輸入 "0.5" 的
// 中途把 "0." 解析成 0，游標跳掉、數字被改寫，沒有人打得完一個小數。
function NumberInput({
  value,
  onCommit,
  disabled,
  placeholder,
  className = "",
}: {
  value: string | number | null;
  onCommit: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const initial = value === null || value === undefined ? "" : String(value);
  const [draft, setDraft] = useState(initial);
  const [editing, setEditing] = useState(false);

  return (
    <input
      type="text"
      inputMode="decimal"
      disabled={disabled}
      value={editing ? draft : initial}
      placeholder={placeholder}
      onFocus={() => {
        setDraft(initial);
        setEditing(true);
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false);
        if (draft !== initial) onCommit(draft.trim());
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setDraft(initial);
          setEditing(false);
        }
      }}
      className={`${inputClass} text-right tabular-nums ${className}`}
    />
  );
}

// ── 算式明細 ───────────────────────────────────────────────────────
function DetailTable({ rows, gross, deduction, net, employerCost }: {
  rows: CalcRow[];
  gross: string;
  deduction: string;
  net: string;
  employerCost: string;
}) {
  const section = (key: CalcRow["section"]) => rows.filter((r) => r.section === key);

  const Block = ({ title, items, total }: { title: string; items: CalcRow[]; total?: string }) => (
    <div>
      <p className="mb-1 text-sm font-bold text-ink-2">{title}</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-base">
          <tbody>
            {items.map((r, i) => (
              <tr key={`${r.label}-${i}`} className="border-b border-line/60 last:border-0">
                <td className="py-1.5 pr-2 text-ink whitespace-nowrap">{r.label}</td>
                {/* 算式就是這頁存在的理由——用等寬字，讓她一眼對得上計算機 */}
                <td className="py-1.5 pr-2 font-mono text-sm text-ink-3">{r.formula}</td>
                <td className="py-1.5 text-right tabular-nums font-semibold text-ink">
                  {nt(r.amount)}
                </td>
              </tr>
            ))}
            {total !== undefined && (
              <tr className="border-t-2 border-line">
                <td className="py-1.5 font-bold text-ink" colSpan={2}>
                  小計
                </td>
                <td className="py-1.5 text-right tabular-nums font-bold text-ink">{nt(total)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <Block title="應發金額" items={section("earning")} total={gross} />
      <Block title="應扣金額" items={section("deduction")} total={deduction} />
      <div className="rounded-lg bg-page p-3">
        <div className="flex items-baseline justify-between">
          <span className="text-base font-bold text-ink">實發金額</span>
          <span className="text-2xl font-bold tabular-nums text-ink">{nt(net)}</span>
        </div>
        <p className="mt-1 text-sm text-ink-3">
          應發 {nt(gross)} − 應扣 {nt(deduction)}
        </p>
      </div>
      {section("employer").length > 0 && (
        <div>
          <Block title="雇主另負擔（不從薪水扣）" items={section("employer")} total={employerCost} />
        </div>
      )}
    </div>
  );
}

// ── 月曆：讓會計師確認「這個月哪幾天要上班」────────────────────────
// 直接把整個月攤開比只給一個數字可信：她比系統清楚實際排班，
// 看到 9/25 標著「中秋節」才有辦法判斷這 20 天對不對。
const DAY_STYLE: Record<
  DayKind,
  { label: string; bg: string; fg: string; border: string }
> = {
  work: {
    label: "上班日",
    bg: "var(--color-card)",
    fg: "var(--color-ink)",
    border: "var(--color-line)",
  },
  weekend: {
    label: "一般假日",
    bg: "color-mix(in srgb, var(--color-ink-3) 12%, transparent)",
    fg: "var(--color-ink-3)",
    border: "transparent",
  },
  holiday: {
    label: "國定假日",
    bg: "color-mix(in srgb, var(--color-delayed) 14%, transparent)",
    fg: "var(--color-delayed)",
    border: "color-mix(in srgb, var(--color-delayed) 35%, transparent)",
  },
  makeup: {
    label: "補班日",
    bg: "color-mix(in srgb, var(--color-atrisk) 16%, transparent)",
    fg: "var(--color-atrisk)",
    border: "color-mix(in srgb, var(--color-atrisk) 40%, transparent)",
  },
};

const WEEK_HEAD = ["日", "一", "二", "三", "四", "五", "六"];

function MonthCalendar({ days }: { days: CalendarDay[] }) {
  if (days.length === 0) return null;
  // 後端的 weekday 是 0=週一…6=週日；月曆從週日排起，所以要換算
  const firstCol = (days[0].weekday + 1) % 7;
  const used = new Set(days.map((d) => d.kind));

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEK_HEAD.map((w) => (
          <div key={w} className="pb-1 text-xs font-semibold text-ink-3">
            {w}
          </div>
        ))}
        {Array.from({ length: firstCol }, (_, i) => (
          <div key={`pad-${i}`} />
        ))}
        {days.map((d) => {
          const st = DAY_STYLE[d.kind];
          // 一般的上班日與週末不寫字——寫了整張表都是字，反而看不出重點。
          // 只有「非一般假日、非一般上班日」才標名稱（國慶日、元旦、補班）
          const label = d.kind === "holiday" || d.kind === "makeup" ? d.name : "";
          return (
            <div
              key={d.date}
              title={d.name ? `${d.date} ${d.name}` : d.date}
              className="rounded-md border px-1 py-1.5 text-center"
              style={{ background: st.bg, borderColor: st.border, color: st.fg }}
            >
              <div className="text-base font-semibold tabular-nums leading-none">{d.day}</div>
              {label && (
                <div className="mt-0.5 truncate text-[11px] leading-tight" title={label}>
                  {label}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {(Object.keys(DAY_STYLE) as DayKind[])
          .filter((k) => used.has(k))
          .map((k) => (
            <span key={k} className="flex items-center gap-1 text-xs text-ink-3">
              <span
                className="inline-block size-3 rounded border"
                style={{ background: DAY_STYLE[k].bg, borderColor: DAY_STYLE[k].border }}
              />
              {DAY_STYLE[k].label}
            </span>
          ))}
      </div>
    </div>
  );
}

// ── 一位員工的薪資單 ───────────────────────────────────────────────
const HOUR_FIELDS: Array<[keyof PayrollRecord, string]> = [
  ["work_days", "上班天數"],
  ["normal_hours", "正常工時"],
  ["ot_weekday_1_hours", "平日加班（前段）"],
  ["ot_weekday_2_hours", "平日加班（後段）"],
  ["ot_restday_1_hours", "休息日（前 2 小時）"],
  ["ot_restday_2_hours", "休息日（3–8 小時）"],
  ["ot_restday_3_hours", "休息日（超過 8 小時）"],
  ["holiday_hours", "國定假日出勤"],
  ["unpaid_leave_hours", "無薪假時數"],
  ["late_minutes", "遲到（分鐘）"],
  ["early_leave_minutes", "早退（分鐘）"],
];

function RecordCard({ record, locked }: { record: PayrollRecord; locked: boolean }) {
  const [open, setOpen] = useState(false);
  const [lineForm, setLineForm] = useState<{ kind: "earning" | "deduction"; label: string; amount: string } | null>(null);
  const save = useSaveRecord();
  const saveLine = useSaveLine();
  const deleteLine = useDeleteLine();
  const toast = useToast();

  const commit = (field: string, raw: string) => {
    const value = raw === "" ? null : raw;
    save.mutate(
      { id: record.id, [field]: value } as never,
      {
        onError: (e: unknown) =>
          toast.error(e instanceof Error ? e.message : "存檔失敗，請確認數字格式"),
      },
    );
  };

  return (
    <Card className="p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="min-w-0">
          <span className="block truncate text-base font-bold text-ink">
            {record.user_name}
            {record.employee_no && (
              <span className="ml-2 text-sm font-normal text-ink-3">{record.employee_no}</span>
            )}
          </span>
          <span className="block text-sm text-ink-3">
            正常 {hrs(record.normal_hours)} 小時 ／ 加班{" "}
            {hrs(
              Number(record.ot_weekday_1_hours) +
                Number(record.ot_weekday_2_hours) +
                Number(record.ot_restday_1_hours) +
                Number(record.ot_restday_2_hours) +
                Number(record.ot_restday_3_hours),
            )}{" "}
            小時
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-xl font-bold tabular-nums text-ink">{nt(record.net)}</span>
          <span className="block text-sm text-ink-3">
            應發 {nt(record.gross)} − 扣 {nt(record.deduction)}
          </span>
        </span>
      </button>

      {record.warnings.length > 0 && (
        <div className="mt-2 space-y-1">
          {record.warnings.map((w) => (
            <p
              key={w}
              className="flex items-start gap-1.5 rounded-lg px-2 py-1.5 text-sm"
              style={{ background: "color-mix(in srgb, var(--color-atrisk) 12%, transparent)" }}
            >
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {w}
            </p>
          ))}
        </div>
      )}

      {open && (
        <div className="mt-3 space-y-4 border-t border-line pt-3">
          <div>
            <p className="mb-2 text-sm font-bold text-ink-2">
              出勤（照打卡表填，改完自動重算）
              <span className="ml-1 font-normal text-ink-3">時數以 0.5 小時為單位</span>
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {HOUR_FIELDS.map(([field, label]) => (
                <label key={String(field)} className="block">
                  <span className="mb-1 block text-sm text-ink-3">{label}</span>
                  <NumberInput
                    value={record[field] as string | number}
                    disabled={locked}
                    onCommit={(v) => commit(String(field), v)}
                  />
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-bold text-ink-2">保險計費（到職／離職不滿一個月才要動）</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-sm text-ink-3">
                  勞保勞退計費天數（分母固定 30）
                </span>
                <NumberInput
                  value={record.insured_days}
                  disabled={locked}
                  onCommit={(v) => commit("insured_days", v)}
                />
              </label>
              <label className="flex items-start gap-2 pt-5">
                <input
                  type="checkbox"
                  checked={record.charge_health_insurance}
                  disabled={locked}
                  onChange={(e) =>
                    save.mutate({ id: record.id, charge_health_insurance: e.target.checked } as never)
                  }
                  className="mt-0.5 size-4 shrink-0"
                />
                <span className="text-sm text-ink-2">
                  本月計收健保
                  <span className="mt-0.5 block text-ink-3">
                    健保不按日拆。月中離職者當月由下一個投保單位負擔，這裡取消勾選
                  </span>
                </span>
              </label>
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-bold text-ink-2">
              本月覆寫（留空＝沿用「員工設定」裡的值）
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {([
                ["hourly_wage", "時薪"],
                ["insured_salary", "投保薪資"],
                ["dependents", "健保眷屬口數"],
              ] as Array<[keyof PayrollRecord, string]>).map(([field, label]) => (
                <label key={String(field)} className="block">
                  <span className="mb-1 block text-sm text-ink-3">{label}</span>
                  <NumberInput
                    value={record[field] as string | number | null}
                    disabled={locked}
                    placeholder="沿用設定"
                    onCommit={(v) => commit(String(field), v)}
                  />
                </label>
              ))}
            </div>
          </div>

          <div>
            <SectionTitle
              action={
                !locked && (
                  <Button
                    variant="ghost"
                    onClick={() => setLineForm({ kind: "earning", label: "", amount: "" })}
                  >
                    <Plus size={14} />
                    加一項
                  </Button>
                )
              }
            >
              其他加扣項（獎金、津貼、借支）
            </SectionTitle>
            {record.lines.length === 0 ? (
              <p className="text-sm text-ink-3">沒有額外的加扣項</p>
            ) : (
              <ul className="space-y-1">
                {record.lines.map((line) => (
                  <li
                    key={line.id}
                    className="flex items-center justify-between gap-2 rounded-lg bg-page px-2 py-1.5 text-base"
                  >
                    <span className="min-w-0 truncate">
                      <span className="text-ink-3">{line.kind_label}</span>　{line.label}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="tabular-nums font-semibold">{nt(line.amount)}</span>
                      {!locked && (
                        <button
                          type="button"
                          onClick={() => deleteLine.mutate(line.id)}
                          className="text-ink-3 hover:text-ink"
                          aria-label={`刪除 ${line.label}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <DetailTable
            rows={record.detail}
            gross={record.gross}
            deduction={record.deduction}
            net={record.net}
            employerCost={record.employer_cost}
          />
        </div>
      )}

      <Modal open={lineForm !== null} onClose={() => setLineForm(null)} title="新增加扣項">
        {lineForm && (
          <div>
            <Field label="類型">
              <Segmented
                value={lineForm.kind}
                onChange={(v) => setLineForm({ ...lineForm, kind: v as "earning" | "deduction" })}
                options={[
                  { value: "earning", label: "加項" },
                  { value: "deduction", label: "扣項" },
                ]}
              />
            </Field>
            <Field label="項目" required hint="例如「全勤獎金」「代扣借支」">
              <input
                className={inputClass}
                value={lineForm.label}
                onChange={(e) => setLineForm({ ...lineForm, label: e.target.value })}
              />
            </Field>
            <Field label="金額" required hint="填正數；要扣錢請把類型選成扣項">
              <input
                className={`${inputClass} text-right tabular-nums`}
                inputMode="decimal"
                value={lineForm.amount}
                onChange={(e) => setLineForm({ ...lineForm, amount: e.target.value })}
              />
            </Field>
            <Button
              variant="primary"
              className="w-full"
              loading={saveLine.isPending}
              onClick={() =>
                saveLine.mutate(
                  {
                    record: record.id,
                    kind: lineForm.kind,
                    label: lineForm.label,
                    amount: lineForm.amount,
                  } as never,
                  {
                    onSuccess: () => setLineForm(null),
                    onError: (e: unknown) =>
                      toast.error(e instanceof Error ? e.message : "新增失敗"),
                  },
                )
              }
            >
              加入並重算
            </Button>
          </div>
        )}
      </Modal>
    </Card>
  );
}

// ── 月薪資 ─────────────────────────────────────────────────────────
function PeriodTab() {
  const toast = useToast();
  const periods = usePayrollPeriods();
  const [selected, setSelected] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  const period: PayrollPeriod | undefined = useMemo(() => {
    const list = periods.data ?? [];
    return list.find((p) => p.id === selected) ?? list[0];
  }, [periods.data, selected]);

  const records = usePayrollRecords(period?.id ?? null);
  const savePeriod = useSavePeriod();
  const resetHours = usePeriodAction("reset-hours");
  const recalc = usePeriodAction("recalc");
  const [resetting, setResetting] = useState<{ deep: boolean } | null>(null);
  const confirm = usePeriodAction("confirm");
  const reopen = usePeriodAction("reopen");
  const pay = usePeriodAction("pay");

  if (periods.isLoading) return <Spinner />;
  if (periods.error) return <ErrorState error={periods.error} onRetry={() => periods.refetch()} />;

  const locked = period?.is_locked ?? false;
  const run =
    (m: ReturnType<typeof usePeriodAction>, okMsg: string, deep?: boolean) => () => {
      if (!period) return;
      m.mutate(
        { id: period.id, deep },
        {
          onSuccess: (r) => toast.success(r?.detail ?? okMsg),
          onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "操作失敗"),
        },
      );
    };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={String(period?.id ?? "")}
          onChange={(v) => setSelected(Number(v))}
          options={(periods.data ?? []).map((p) => ({
            value: p.id,
            label: `${p.year} 年 ${p.month} 月　${p.status_label}`,
          }))}
          placeholder="選擇月份"
        />
        <Button onClick={() => setCreating(true)}>
          <Plus size={15} />
          新增月份
        </Button>
      </div>

      {!period ? (
        <EmptyState
          title="還沒有任何薪資月份"
          hint="按「新增月份」建立第一個月——系統會算出應上班天數，並直接把每個人的薪資單與工時都建好"
        />
      ) : (
        <>
          <Card className="p-3">
            <SectionTitle
              action={
                <span
                  className="rounded-full px-2 py-0.5 text-sm font-semibold"
                  style={{
                    background: locked
                      ? "color-mix(in srgb, var(--color-ontrack) 15%, transparent)"
                      : "var(--color-page)",
                  }}
                >
                  {locked && <Lock size={11} className="mr-1 inline" />}
                  {period.status_label}
                </span>
              }
            >
              {period.year} 年 {period.month} 月
            </SectionTitle>

            <div className="grid grid-cols-3 gap-2">
              {([
                ["workdays", "應上班天數"],
                ["normal_hours_per_day", "每日正常工時"],
                ["daily_ot_hours", "每日固定加班"],
              ] as const).map(([field, label]) => (
                <label key={field} className="block">
                  <span className="mb-1 block text-sm text-ink-3">{label}</span>
                  <NumberInput
                    value={period[field]}
                    disabled={locked}
                    onCommit={(v) =>
                      savePeriod.mutate({ id: period.id, [field]: v } as never, {
                        onError: (e: unknown) =>
                          toast.error(e instanceof Error ? e.message : "存檔失敗"),
                      })
                    }
                  />
                </label>
              ))}
            </div>
            <p className="mt-2 text-sm text-ink-3">
              薪資單<span className="font-semibold">建立月份時就自動產生好了</span>，
              工時已照
              <span className="font-semibold">　天數 × 正常工時 ＋ 天數 × 固定加班　</span>
              帶入，你只要對打卡表調整差異。
              新人、離職、改到職日這些也會自動反映，
              <span className="font-semibold">不需要記得按任何按鈕</span>。
            </p>
            <div className="mt-1 rounded-lg bg-page p-2.5 text-sm text-ink-3">
              <p className="font-semibold text-ink-2">兩顆按鈕的差別（都不會動到金額以外的設定）：</p>
              <p className="mt-1">
                <span className="font-semibold text-ink">重算薪資</span>
                　只重算<span className="font-semibold">金額</span>，出勤數字原封不動。
                改了法規參數（費率、加班倍率）、時薪或投保級距之後按這個。
              </p>
              <p className="mt-1">
                <span className="font-semibold text-ink">重設工時</span>
                　把<span className="font-semibold">工時覆蓋</span>成「天數 × 每日工時」。
                只有改了上面三個數字、想讓所有人重新帶一次時才需要——
                它會蓋掉你已經照打卡表 key 好的資料，所以按下去會先問。
              </p>
            </div>
            <p className="mt-1 text-sm text-ink-3">
              「下載 Excel」有三張表：<span className="font-semibold">薪資總表</span>（每人一列）、
              <span className="font-semibold">計算明細</span>（每一行的算式，可以拿去核對）、
              <span className="font-semibold">銀行匯款</span>（編號、姓名、實發金額）。
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              {!locked && (
                <>
                  <Button variant="primary" loading={confirm.isPending} onClick={run(confirm, "已確認")}>
                    <Check size={15} />
                    確認並鎖定
                  </Button>
                  <Button loading={recalc.isPending} onClick={run(recalc, "已重算")}>
                    <RotateCcw size={15} />
                    重算薪資
                  </Button>
                  {/* 這顆會覆蓋已經 key 的工時，所以按下去先問清楚 */}
                  <Button onClick={() => setResetting({ deep: false })}>
                    <Calculator size={15} />
                    重設工時
                  </Button>
                </>
              )}
              {/* 下載走一般連結而不是 fetch：同源、帶著 session cookie，
                  瀏覽器自己處理另存新檔，不必把整個檔案讀進記憶體 */}
              <a
                href={`/api/v0.1/payroll-periods/${period.id}/xlsx`}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-card
                           px-3 py-2 text-base font-semibold text-ink ring-1 ring-line
                           transition-base hover:bg-page"
              >
                <Download size={15} />
                下載 Excel
              </a>
              {period.status === "confirmed" && (
                <Button loading={pay.isPending} onClick={run(pay, "已標記發放")}>
                  標記為已發放
                </Button>
              )}
              {locked && (
                <Button variant="ghost" loading={reopen.isPending} onClick={run(reopen, "已退回草稿")}>
                  退回草稿
                </Button>
              )}
            </div>
            {locked && (
              <p className="mt-2 text-sm text-ink-3">
                已確認的月份不能改數字——薪水是錢的歷程。要修改請按「退回草稿」。
                {period.status === "paid" && (
                  <span className="block">
                    ⚠️ 這個月已經發放。薪水匯出去之後改帳面追不回錢，
                    退回的動作會記在備註裡；真的算錯時，比較安全的作法是
                    在下個月用加項／扣項補正差額。
                  </span>
                )}
              </p>
            )}
          </Card>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {([
              ["人數", `${period.totals.headcount}`],
              ["應發合計", nt(period.totals.gross)],
              ["應扣合計", nt(period.totals.deduction)],
              ["實發合計", nt(period.totals.net)],
            ] as const).map(([label, value]) => (
              <Card key={label} className="p-3">
                <p className="text-sm font-semibold text-ink-2">{label}</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-ink">{value}</p>
              </Card>
            ))}
          </div>

          {records.isLoading ? (
            <Spinner />
          ) : (records.data ?? []).length === 0 ? (
            <EmptyState
              title="這個月沒有任何薪資單"
              hint="表示目前沒有「納入薪資計算」的在職員工。到「員工設定」確認，或按那裡的「同步員工名冊」"
            />
          ) : (
            <div className="space-y-2">
              {(records.data ?? []).map((r) => (
                <RecordCard key={r.id} record={r} locked={locked} />
              ))}
            </div>
          )}
        </>
      )}

      <CreatePeriodModal open={creating} onClose={() => setCreating(false)} />

      <Modal
        open={resetting !== null && period !== undefined}
        onClose={() => setResetting(null)}
        title="重設工時"
      >
        {resetting && period && (
          <div>
            <p className="mb-2 text-base text-ink">
              照現在的設定（應上班 {hrs(period.workdays)} 天 × 每日{" "}
              {hrs(period.normal_hours_per_day)} 小時、固定加班{" "}
              {hrs(period.daily_ot_hours)} 小時）把工時整批重帶。
            </p>
            <div
              className="mb-3 rounded-lg p-3 text-sm"
              style={{ background: "color-mix(in srgb, var(--color-atrisk) 12%, transparent)" }}
            >
              <p className="font-semibold text-ink">會被蓋掉的：</p>
              <p className="mt-0.5 text-ink-2">
                每個人的<span className="font-semibold">應上班天數、正常工時、平日加班（前段）</span>
              </p>
              <p className="mt-1.5 font-semibold text-ink">不會動到的：</p>
              <p className="mt-0.5 text-ink-2">
                休息日加班、國定假日出勤、請假、遲到早退、加扣項、本月覆寫
              </p>
            </div>
            <label className="mb-3 flex items-start gap-2">
              <input
                type="checkbox"
                checked={resetting.deep}
                onChange={(e) => setResetting({ deep: e.target.checked })}
                className="mt-1 size-4 shrink-0"
              />
              <span className="text-base text-ink-2">
                連手填的也一起歸零
                <span className="mt-0.5 block text-sm text-ink-3">
                  休息日加班、國定假日出勤、請假、遲到早退全部歸 0，整個月從頭來過
                </span>
              </span>
            </label>
            <Button
              variant={resetting.deep ? "danger" : "primary"}
              className="w-full"
              loading={resetHours.isPending}
              onClick={() => {
                run(resetHours, "已重設工時", resetting.deep)();
                setResetting(null);
              }}
            >
              {resetting.deep ? "整個月從頭來過" : "重設工時"}
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}

function CreatePeriodModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const suggestion = usePeriodSuggestion(year, month, open);
  const create = useCreatePeriod();
  const toast = useToast();

  return (
    <Modal open={open} onClose={onClose} title="新增薪資月份">
      <div className="grid grid-cols-2 gap-2">
        <Field label="年" required>
          <input
            className={`${inputClass} text-right tabular-nums`}
            inputMode="numeric"
            value={year}
            onChange={(e) => setYear(Number(e.target.value) || year)}
          />
        </Field>
        <Field label="月" required>
          <Select
            value={String(month)}
            onChange={(v) => setMonth(Number(v))}
            options={Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: `${i + 1} 月` }))}
            className="w-full"
          />
        </Field>
      </div>

      <ImportHolidayHint year={year} holidayCount={suggestion.data?.holidays.length ?? 0} />

      {suggestion.data && (
        <div className="mb-3 rounded-lg bg-page p-3 text-base">
          <p className="font-semibold text-ink">
            系統算出的應上班天數：{hrs(suggestion.data.workdays)} 天
          </p>
          <p className="mb-2 mt-1 text-sm text-ink-3">
            當月週一至週五共 {suggestion.data.weekdays} 天
            {suggestion.data.holidays.length > 0 && (
              <>
                ，扣掉國定假日{" "}
                {suggestion.data.holidays.map((h) => `${h.date.slice(5)} ${h.name}`).join("、")}
              </>
            )}
            。請對一下下面的日曆，建立後這個數字還可以直接改。
          </p>
          <MonthCalendar days={suggestion.data.days} />
        </div>
      )}

      <Button
        variant="primary"
        className="w-full"
        loading={create.isPending}
        onClick={() =>
          create.mutate(
            { year, month },
            {
              onSuccess: () => {
                toast.success(`${year} 年 ${month} 月已建立`);
                onClose();
              },
              onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "建立失敗"),
            },
          )
        }
      >
        建立
      </Button>
    </Modal>
  );
}

// ── 行事曆：從政府資料開放平臺匯入 ─────────────────────────────────
// 系統內建只有 2026。要算 2027 的薪水就得先有 2027 的假日，
// 而人事行政總處每年年中會公告下一年——所以做成「按一下就抓回來」，
// 不是每年請工程師改一次程式。
function ImportHolidayHint({ year, holidayCount }: { year: number; holidayCount: number }) {
  const holidays = useHolidays(year);
  const doImport = useImportHolidays();
  const toast = useToast();
  const empty = (holidays.data?.length ?? 0) === 0;

  if (!empty || holidays.isLoading) {
    // 有資料就不囉嗦；holidayCount 只是提醒這個月剛好沒有假日很正常
    if (!empty || holidayCount > 0) return null;
  }
  return (
    <div
      className="mb-3 rounded-lg p-3 text-sm"
      style={{ background: "color-mix(in srgb, var(--color-atrisk) 12%, transparent)" }}
    >
      <p className="font-semibold text-ink">系統裡還沒有 {year} 年的國定假日</p>
      <p className="mt-1 text-ink-2">
        沒有假日資料時，「應上班天數」只會扣掉週末，國定假日不會被扣掉。
        按下面的鈕從<span className="font-semibold">政府資料開放平臺</span>
        （人事行政總處公告的辦公日曆表）抓回來。
      </p>
      <Button
        className="mt-2"
        loading={doImport.isPending}
        onClick={() =>
          doImport.mutate(year, {
            onSuccess: (r) => toast.success(r.detail),
            onError: (e: unknown) =>
              toast.error(e instanceof Error ? e.message : "匯入失敗"),
          })
        }
      >
        <Download size={15} />
        匯入 {year} 年行事曆
      </Button>
    </div>
  );
}

function CalendarTab() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const holidays = useHolidays(year);
  const doImport = useImportHolidays();
  const del = useDeleteHoliday();
  const save = useSaveHoliday();
  const toast = useToast();
  const [adding, setAdding] = useState<{ date: string; name: string; is_workday: boolean } | null>(
    null,
  );

  return (
    <div className="space-y-3">
      <Card className="p-3">
        <SectionTitle
          action={
            <div className="flex items-center gap-2">
              <Select
                value={String(year)}
                onChange={(v) => setYear(Number(v))}
                options={Array.from({ length: 7 }, (_, i) => {
                  const y = now.getFullYear() - 2 + i;
                  return { value: y, label: `${y} 年（民國 ${y - 1911}）` };
                })}
              />
              <Button
                loading={doImport.isPending}
                onClick={() =>
                  doImport.mutate(year, {
                    onSuccess: (r) => toast.success(r.detail),
                    onError: (e: unknown) =>
                      toast.error(e instanceof Error ? e.message : "匯入失敗"),
                  })
                }
              >
                <Download size={15} />
                從政府平臺匯入
              </Button>
            </div>
          }
        >
          國定假日與補班日
        </SectionTitle>
        <p className="text-sm text-ink-3">
          資料來源是<span className="font-semibold">政府資料開放平臺</span>的
          「中華民國政府行政機關辦公日曆表」（人事行政總處公告，通常前一年年中發布）。
          <br />
          只記錄<span className="font-semibold">跟「平日上班、週末放假」不一樣的日子</span>：
          平日放假的（國定假日、補假）與週末要上班的（補班日）。一般的週六週日不必登記。
          <br />
          這台機器如果連不到外網，匯入會失敗——那就用下面的「自己加一天」手動補。
        </p>
      </Card>

      <Card className="p-3">
        <SectionTitle
          action={
            <Button
              onClick={() =>
                setAdding({ date: `${year}-01-01`, name: "", is_workday: false })
              }
            >
              <Plus size={15} />
              自己加一天
            </Button>
          }
        >
          {year} 年共 {holidays.data?.length ?? 0} 天
        </SectionTitle>
        {holidays.isLoading ? (
          <Spinner />
        ) : (holidays.data ?? []).length === 0 ? (
          <EmptyState
            title={`還沒有 ${year} 年的資料`}
            hint="按上面的「從政府平臺匯入」，或自己一天一天加"
          />
        ) : (
          <ul className="grid gap-1 sm:grid-cols-2">
            {(holidays.data ?? []).map((h) => (
              <li
                key={h.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-page px-2 py-1.5 text-base"
              >
                <span className="min-w-0 truncate">
                  <span className="tabular-nums text-ink-3">{h.date.slice(5)}</span>
                  <span className="ml-2 text-ink">{h.name}</span>
                  {h.is_workday && (
                    <span
                      className="ml-2 rounded px-1.5 py-0.5 text-xs font-semibold"
                      style={{
                        background: "color-mix(in srgb, var(--color-atrisk) 20%, transparent)",
                        color: "var(--color-atrisk)",
                      }}
                    >
                      補班
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => del.mutate(h.id)}
                  className="shrink-0 text-ink-3 hover:text-ink"
                  aria-label={`刪除 ${h.date} ${h.name}`}
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal open={adding !== null} onClose={() => setAdding(null)} title="自己加一天">
        {adding && (
          <div>
            <Field label="日期" required>
              <DateInput
                value={adding.date}
                onChange={(v) => setAdding({ ...adding, date: v })}
              />
            </Field>
            <Field label="名稱" required hint="例如「國慶日」「颱風停班」「補行上班」">
              <input
                className={inputClass}
                value={adding.name}
                onChange={(e) => setAdding({ ...adding, name: e.target.value })}
              />
            </Field>
            <label className="mb-3 flex items-start gap-2">
              <input
                type="checkbox"
                checked={adding.is_workday}
                onChange={(e) => setAdding({ ...adding, is_workday: e.target.checked })}
                className="mt-1 size-4 shrink-0"
              />
              <span className="text-sm text-ink-2">
                這天要上班（補班日）
                <span className="mt-0.5 block text-ink-3">
                  本來是週末但政府公告要上班時打勾，應上班天數會加一天
                </span>
              </span>
            </label>
            <Button
              variant="primary"
              className="w-full"
              loading={save.isPending}
              onClick={() =>
                save.mutate(adding as never, {
                  onSuccess: () => setAdding(null),
                  onError: (e: unknown) =>
                    toast.error(e instanceof Error ? e.message : "新增失敗"),
                })
              }
            >
              新增
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ── 員工設定 ───────────────────────────────────────────────────────
function ProfileTab() {
  const profiles = useSalaryProfiles();
  const grades = useInsuranceGrades();
  const policy = usePayrollPolicy();
  const save = useSaveProfile();
  const sync = useSyncProfiles();
  const toast = useToast();

  if (profiles.isLoading) return <Spinner />;
  if (profiles.error) return <ErrorState error={profiles.error} onRetry={() => profiles.refetch()} />;

  const commit = (p: SalaryProfile, field: string, raw: string) =>
    save.mutate({ id: p.id, [field]: raw === "" ? null : raw } as never, {
      onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "存檔失敗"),
    });

  const minWage = policy.data?.min_hourly_wage;
  const minWageHint = minWage ? `用最低時薪（${nt(minWage)}）` : "用最低時薪";

  return (
    <div className="space-y-3">
      <Card className="p-3">
        <SectionTitle
          action={
            <Button
              loading={sync.isPending}
              onClick={() =>
                sync.mutate(undefined, {
                  onSuccess: (r) => toast.success(r.detail),
                  onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "同步失敗"),
                })
              }
            >
              同步員工名冊
            </Button>
          }
        >
          員工薪資設定
        </SectionTitle>
        <div className="space-y-1.5 text-sm text-ink-2">
          <p>
            <span className="font-semibold text-ink">這一頁設定一次就好，不用每個月重填。</span>
            這裡放的是「每個月都一樣、跟出勤無關」的東西；會變的出勤數字記在每個月的薪資單上。
            改了這裡，所有<span className="font-semibold">草稿</span>月份會立刻跟著重算
            （已確認／已發放的月份不動——那是凍結的歷史）。
          </p>
          <p>
            <span className="font-semibold text-ink">「同步員工名冊」在做什麼：</span>
            替<span className="font-semibold">還沒有薪資設定</span>的在職員工各建一張（用法規預設值）。
            新人進來時按一下就補齊，不必記得「還要去薪資那邊建一筆」。
            已經有的不會被改，所以可以重複按。
            <span className="font-semibold">停用的帳號與系統管理員不會被建進來</span>，
            也不會出現在任何月份的薪資單上。
          </p>
          <p>
            <span className="font-semibold text-ink">時薪</span>留空＝跟著法規參數的最低時薪
            {policy.data && <>（目前 {nt(policy.data.min_hourly_wage)} 元）</>}
            走，明年調基本工資時不必一個一個改。
            <span className="font-semibold text-ink">投保薪資</span>是向勞保局申報的級距，
            不是實發金額——但要對得上實際月薪資總額，
            差太多時薪資單上會出現提醒（高報低報都違法）。
          </p>
          <p>
            <span className="font-semibold text-ink">「納入薪資計算」</span>取消勾選的人，
            草稿月份的薪資單會自動移除（他還是在職員工，只是不從這裡發薪水）；
            重新勾回來就自動補回。
          </p>
          <p>
            填了<span className="font-semibold text-ink">到職日／離職日</span>之後
            <span className="font-semibold">立刻生效，不必再去按「產生薪資單」</span>：
            工時按實際在職的上班天數算、勞保勞退按 30 日制的在職天數算、
            健保看月底那天還在不在職——三種規則不一樣，系統各自算好。
            那個月完全不在職的人，薪資單會自動收掉。
          </p>
        </div>
      </Card>

      {(profiles.data ?? []).length === 0 ? (
        <EmptyState title="還沒有員工薪資設定" hint="按「同步員工名冊」替在職員工各建一張" />
      ) : (
        <div className="space-y-2">
          {(profiles.data ?? []).map((p) => (
            <Card key={p.id} className={`p-3 ${p.is_active ? "" : "opacity-60"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-base font-bold text-ink">
                  {p.user_name}
                  {p.employee_no && (
                    <span className="ml-2 text-sm font-normal text-ink-3">{p.employee_no}</span>
                  )}
                  {p.title && <span className="ml-2 text-sm font-normal text-ink-3">{p.title}</span>}
                </p>
                {/* 沒有這個開關的話，「不納入」就變成單向門——關掉之後
                    畫面上找不到開回來的地方 */}
                <label className="flex items-center gap-1.5 text-sm text-ink-2">
                  <input
                    type="checkbox"
                    checked={p.is_active}
                    onChange={(e) =>
                      save.mutate({ id: p.id, is_active: e.target.checked } as never, {
                        onError: (err: unknown) =>
                          toast.error(err instanceof Error ? err.message : "存檔失敗"),
                      })
                    }
                    className="size-4"
                  />
                  納入薪資計算
                </label>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <label className="block">
                  <span className="mb-1 block text-sm text-ink-3">時薪</span>
                  <NumberInput
                    value={p.hourly_wage}
                    // 留空時直接把實際會用到的金額寫在格子裡——
                    // 「用最低時薪」四個字沒有回答「那到底是多少」
                    placeholder={minWageHint}
                    onCommit={(v) => commit(p, "hourly_wage", v)}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm text-ink-3">投保薪資</span>
                  <Select
                    value={String(Number(p.insured_salary))}
                    onChange={(v) => commit(p, "insured_salary", v)}
                    options={(grades.data ?? []).map((g) => ({
                      value: Number(g.amount),
                      label: `第 ${g.level} 級　${nt(g.amount)}`,
                    }))}
                    className="w-full"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm text-ink-3">健保眷屬口數</span>
                  <NumberInput value={p.dependents} onCommit={(v) => commit(p, "dependents", v)} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm text-ink-3">勞退自願提繳 %</span>
                  <NumberInput
                    value={p.voluntary_pension_rate}
                    onCommit={(v) => commit(p, "voluntary_pension_rate", v)}
                  />
                </label>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <label className="block">
                  <span className="mb-1 block text-sm text-ink-3">到職日</span>
                  <DateInput
                    value={p.hire_date ?? ""}
                    onChange={(v) => commit(p, "hire_date", v)}
                    placeholder="到職已久"
                    aria-label={`${p.user_name} 的到職日`}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm text-ink-3">離職日</span>
                  <DateInput
                    value={p.resign_date ?? ""}
                    onChange={(v) => commit(p, "resign_date", v)}
                    placeholder="仍在職"
                    aria-label={`${p.user_name} 的離職日`}
                  />
                </label>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 法規參數 ───────────────────────────────────────────────────────
const POLICY_GROUPS: Array<{ title: string; note: string; fields: Array<[string, string, string?]> }> = [
  {
    title: "工資",
    note: "勞動部公告的最低工資。115 年（2026）起為月薪 29,500 元／時薪 196 元。",
    fields: [
      ["min_hourly_wage", "最低時薪"],
      ["normal_hours_per_day", "每日正常工時", "勞基法 §30：不得超過 8 小時"],
      ["default_daily_ot_hours", "每日固定加班時數", "8:00–17:30 扣 1 小時休息＝8.5，多的 0.5 算加班"],
    ],
  },
  {
    title: "加班倍率（勞基法 §24）",
    note:
      "法條寫「加給三分之一以上」。勞動部建議用 1.34／1.67 而不是 1.33／1.66——" +
      "四捨五入後 1.33 會低於法定下限，少給就是違法。",
    fields: [
      ["ot_weekday_1_rate", "平日加班前段倍率"],
      ["ot_weekday_1_hours", "平日加班前段時數"],
      ["ot_weekday_2_rate", "平日加班後段倍率"],
      ["ot_restday_1_rate", "休息日前 2 小時倍率"],
      ["ot_restday_2_rate", "休息日第 3–8 小時倍率"],
      ["ot_restday_3_rate", "休息日超過 8 小時倍率"],
      ["holiday_rate", "國定假日出勤倍率", "§39 加倍發給"],
    ],
  },
  {
    title: "勞保（含就業保險）",
    note:
      "普通事故 11.5% ＋ 就業保險 1% ＝ 12.5%；勞工 20%／雇主 70%／政府 10%。" +
      "★ 勞保按日計，分母固定 30 日（不分大小月）。",
    fields: [
      ["labor_insurance_rate", "勞保費率 %"],
      ["labor_insurance_employee_share", "勞工負擔 %", "從薪水扣的部分"],
      ["labor_insurance_employer_share", "雇主負擔 %", "公司出，不扣員工"],
    ],
  },
  {
    title: "健保",
    note:
      "費率 5.17%；被保險人 30%／投保單位 60%／政府 10%。眷屬超過 3 口以 3 口計。" +
      "★ 健保不按日拆——整月計收，由「當月最後一天」的投保單位負擔。",
    fields: [
      ["health_insurance_rate", "健保費率 %"],
      ["health_insurance_employee_share", "本人負擔 %", "每一口各算一份"],
      ["health_max_dependents", "眷屬計費上限", "超過就以上限計"],
      ["health_insurance_employer_share", "投保單位負擔 %", "公司出"],
      ["health_employer_head_factor", "雇主計費人數", "本人 1 ＋ 全國平均眷口 0.56，與實際眷屬數無關"],
    ],
  },
  {
    title: "勞退與公司規定",
    note: "勞退雇主提繳 6% 是公司的成本，不從薪水扣。員工福利金是公司自訂，按應發總額計。",
    fields: [
      ["pension_employer_rate", "勞退雇主提繳 %"],
      ["welfare_fund_rate", "員工福利金 %"],
    ],
  },
  {
    title: "法定上限（只提醒，不阻擋）",
    note: "勞基法 §32：延長工時一日不得超過 4 小時、一個月不得超過 46 小時。",
    fields: [
      ["daily_ot_hours_cap", "每日加班上限"],
      ["monthly_ot_hours_cap", "每月加班上限"],
    ],
  },
];

/** 一步一步的算式。分行寫是因為「458 怎麼來的」不能只給一個乘法式子 */
function Step({
  title,
  rows,
  result,
  note,
}: {
  title: string;
  rows: Array<[string, string]>;
  result: string;
  note?: string;
}) {
  return (
    <div className="rounded-lg border border-line p-3">
      <p className="mb-1.5 text-base font-bold text-ink">{title}</p>
      <table className="w-full">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <td className="w-32 py-0.5 align-top text-sm text-ink-3">{label}</td>
              <td className="py-0.5 font-mono text-sm text-ink">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1.5 border-t border-line pt-1.5 text-base font-bold text-ink">{result}</p>
      {note && <p className="mt-1 text-sm text-ink-3">{note}</p>}
    </div>
  );
}

// ── 法規說明 ───────────────────────────────────────────────────────
// 為什麼要在系統裡放這一頁：會計師每次算薪水都要回答同一批問題
//（為什麼健保要乘兩口？雇主出多少？月中離職怎麼算？），
// 而答案散在三個政府網站上。放在算薪水的旁邊，才會有人真的看。
//
// ★ 例子裡的數字全部**由當前參數即時算出來**，不是寫死的字串——
//   改了費率，例子跟著變。否則參數改了、說明沒改，這頁就開始騙人。
function LawTab() {
  const policy = usePayrollPolicy();
  if (policy.isLoading) return <Spinner />;
  if (policy.error) return <ErrorState error={policy.error} onRetry={() => policy.refetch()} />;
  const d = policy.data!;

  const num = (v: string | number) => Number(v);
  const base = 29500; // 例子用最低那一級，跟大多數人的實際狀況一致
  const r = (v: number) => Math.round(v);
  // 中間過程要看得到小數，才知道 457.545 是怎麼變成 458 的
  const fmt2 = (v: number) =>
    v.toLocaleString("zh-TW", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
  const laborSelf = r((base * num(d.labor_insurance_rate) * num(d.labor_insurance_employee_share)) / 10000);
  const laborBoss = r((base * num(d.labor_insurance_rate) * num(d.labor_insurance_employer_share)) / 10000);
  const healthOne = r((base * num(d.health_insurance_rate) * num(d.health_insurance_employee_share)) / 10000);
  const healthBoss = r(
    (base * num(d.health_insurance_rate) * num(d.health_insurance_employer_share) *
      num(d.health_employer_head_factor)) / 10000,
  );
  const pensionBoss = r((base * num(d.pension_employer_rate)) / 100);

  return (
    <div className="space-y-3">
      <Card className="p-3">
        <SectionTitle>三種保險，一次看懂</SectionTitle>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-base">
            <thead>
              <tr className="border-b border-line text-left text-sm text-ink-2">
                <th className="py-1.5 pr-2">　</th>
                <th className="py-1.5 pr-2">保什麼</th>
                <th className="py-1.5 pr-2">費率</th>
                <th className="py-1.5 pr-2">誰出</th>
                <th className="py-1.5">算哪個薪資</th>
              </tr>
            </thead>
            <tbody className="text-ink">
              <tr className="border-b border-line/60">
                <td className="py-1.5 pr-2 font-semibold whitespace-nowrap">勞保<br />（含就保）</td>
                <td className="py-1.5 pr-2">生育、傷病、失能、老年、死亡；就保管失業給付</td>
                <td className="py-1.5 pr-2 tabular-nums whitespace-nowrap">{d.labor_insurance_rate}%</td>
                <td className="py-1.5 pr-2 whitespace-nowrap">
                  勞工 {num(d.labor_insurance_employee_share)}%／雇主{" "}
                  {num(d.labor_insurance_employer_share)}%／政府 10%
                </td>
                <td className="py-1.5">投保薪資</td>
              </tr>
              <tr className="border-b border-line/60">
                <td className="py-1.5 pr-2 font-semibold">健保</td>
                <td className="py-1.5 pr-2">看病、住院、拿藥</td>
                <td className="py-1.5 pr-2 tabular-nums whitespace-nowrap">{d.health_insurance_rate}%</td>
                <td className="py-1.5 pr-2 whitespace-nowrap">
                  本人 {num(d.health_insurance_employee_share)}%／投保單位{" "}
                  {num(d.health_insurance_employer_share)}%／政府 10%
                </td>
                <td className="py-1.5">投保金額</td>
              </tr>
              <tr>
                <td className="py-1.5 pr-2 font-semibold">勞退</td>
                <td className="py-1.5 pr-2">存進勞工個人退休金專戶（是他的錢，不是保險）</td>
                <td className="py-1.5 pr-2 tabular-nums whitespace-nowrap">
                  {num(d.pension_employer_rate)}% ＋ 自願 0–6%
                </td>
                <td className="py-1.5 pr-2">雇主全額；自願的才從薪水扣</td>
                <td className="py-1.5">月提繳工資</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-sm text-ink-3">
          ⚠️ 三者算的都<span className="font-semibold">不是實發薪水</span>，
          是各自分級表上的申報級距（見「級距」子頁）。所以加班多的月份實發變多，
          保費不會跟著跳——除非投保級距本身調整。
        </p>
      </Card>

      <Card className="p-3">
        <SectionTitle>實例：投保 {nt(base)}、本人＋1 位眷屬（整月在職）</SectionTitle>
        <p className="mb-2 text-sm text-ink-3">
          一步一步拆給你看。系統算的就是這幾步，薪資單上每一行的算式也是同一套。
        </p>

        <div className="space-y-3">
          <Step
            title="① 勞保自付（含就業保險）"
            rows={[
              ["公式", "投保薪資 × 勞保費率 × 勞工負擔比例"],
              ["代入", `${nt(base)} × ${num(d.labor_insurance_rate)}% × ${num(d.labor_insurance_employee_share)}%`],
              ["先算全額保費", `${nt(base)} × ${num(d.labor_insurance_rate)}% ＝ ${fmt2((base * num(d.labor_insurance_rate)) / 100)}`],
              ["勞工只出兩成", `${fmt2((base * num(d.labor_insurance_rate)) / 100)} × ${num(d.labor_insurance_employee_share)}% ＝ ${fmt2((base * num(d.labor_insurance_rate) * num(d.labor_insurance_employee_share)) / 10000)}`],
            ]}
            result={`四捨五入 ＝ ${nt(laborSelf)} 元`}
          />

          <Step
            title="② 健保自付（每一口各算一份）"
            rows={[
              ["公式", "投保金額 × 健保費率 × 本人負擔比例 ×（本人＋眷屬口數）"],
              ["先算全額保費", `${nt(base)} × ${num(d.health_insurance_rate)}% ＝ ${fmt2((base * num(d.health_insurance_rate)) / 100)}`],
              ["本人只出三成", `${fmt2((base * num(d.health_insurance_rate)) / 100)} × ${num(d.health_insurance_employee_share)}% ＝ ${fmt2((base * num(d.health_insurance_rate) * num(d.health_insurance_employee_share)) / 10000)}`],
              ["四捨五入成一口的錢", `${fmt2((base * num(d.health_insurance_rate) * num(d.health_insurance_employee_share)) / 10000)} → ${nt(healthOne)} 元／口`],
              ["本人＋1 眷屬＝2 口", `${nt(healthOne)} × 2 ＝ ${nt(healthOne * 2)}`],
            ]}
            result={`合計 ＝ ${nt(healthOne * 2)} 元`}
            note={`★ 先四捨五入成「一口的錢」再乘人數，不是先乘再四捨五入——這樣才跟健保署的對照表對得起來。眷屬超過 ${d.health_max_dependents} 口以 ${d.health_max_dependents} 口計。`}
          />

          <Step
            title="③ 勞退：員工不用出"
            rows={[
              ["雇主強制提繳", `${nt(base)} × ${num(d.pension_employer_rate)}% ＝ ${nt(pensionBoss)}（公司出，不從薪水扣）`],
              ["員工自願提繳", "0～6% 自己選。選了才從薪水扣，而且不計入當年度所得課稅"],
            ]}
            result={`本例自願提繳 0% ＝ 0 元`}
          />
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg bg-page p-3">
            <p className="text-sm font-bold text-ink-2">員工這個月被扣</p>
            <p className="mt-1 text-base text-ink">
              勞保 {nt(laborSelf)} ＋ 健保 {nt(healthOne * 2)} ＝{" "}
              <span className="text-xl font-bold tabular-nums">{nt(laborSelf + healthOne * 2)}</span>
            </p>
            <p className="mt-1 text-sm text-ink-3">
              （薪資單上還會再扣員工福利金＝應發總額 × {num(d.welfare_fund_rate)}%，那是公司規定不是法規）
            </p>
          </div>
          <div className="rounded-lg bg-page p-3">
            <p className="text-sm font-bold text-ink-2">公司另外要出</p>
            <p className="mt-1 text-base text-ink">
              勞保 {nt(laborBoss)} ＋ 健保 {nt(healthBoss)} ＋ 勞退 {nt(pensionBoss)} ＝{" "}
              <span className="text-xl font-bold tabular-nums">
                {nt(laborBoss + healthBoss + pensionBoss)}
              </span>
            </p>
            <p className="mt-1 text-sm text-ink-3">
              勞保 × {num(d.labor_insurance_employer_share)}%、健保 ×{" "}
              {num(d.health_insurance_employer_share)}% × {num(d.health_employer_head_factor)}、
              勞退 × {num(d.pension_employer_rate)}%
            </p>
          </div>
        </div>
      </Card>

      <Card className="p-3">
        <SectionTitle>「健保雇主計費人數 {num(d.health_employer_head_factor)}」是什麼？</SectionTitle>
        <p className="text-base leading-relaxed text-ink">
          這個數字<span className="font-semibold">只用在計算公司要出多少健保費</span>，
          跟員工被扣多少完全無關。
        </p>
        <ul className="mt-2 space-y-1.5 text-base text-ink-2">
          <li>
            · <span className="font-semibold">員工那邊</span>：照他
            <span className="font-semibold">實際</span>有幾個眷屬算——1 口就 1 份、3 口就 3 份。
          </li>
          <li>
            · <span className="font-semibold">公司這邊</span>：法規規定不看實際眷屬數，
            一律用<span className="font-semibold">全國平均眷口數</span>。
            {num(d.health_employer_head_factor)} ＝ 本人 1 ＋ 平均眷口{" "}
            {(num(d.health_employer_head_factor) - 1).toFixed(2)}
            （2024 年起由 0.57 調降為 0.56）。
          </li>
        </ul>
        <p className="mt-2 text-base text-ink-2">
          為什麼要這樣設計：如果按實際眷屬數算，
          <span className="font-semibold">請有小孩的人就會比較貴</span>，
          公司會有動機不錄用他們。改成全國平均，公司請誰的健保成本都一樣。
        </p>
        <div className="mt-2 rounded-lg bg-page p-3 text-base">
          <p className="font-semibold text-ink">舉例：同樣投保 {nt(base)}</p>
          <table className="mt-1 w-full text-base">
            <thead>
              <tr className="text-left text-sm text-ink-3">
                <th className="py-1 pr-2">員工的眷屬</th>
                <th className="py-1 pr-2">他被扣</th>
                <th className="py-1">公司出</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {[0, 1, 3].map((n) => (
                <tr key={n} className="border-t border-line/60">
                  <td className="py-1 pr-2">{n} 口</td>
                  <td className="py-1 pr-2 font-semibold">{nt(healthOne * (n + 1))}</td>
                  <td className="py-1 font-semibold">{nt(healthBoss)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-sm text-ink-3">
            公司那一欄從頭到尾都一樣——這就是平均眷口數的作用。
          </p>
        </div>
      </Card>

      <Card className="p-3">
        <SectionTitle>到職／離職不滿一個月——三種規則不一樣</SectionTitle>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-base">
            <thead>
              <tr className="border-b border-line text-left text-sm text-ink-2">
                <th className="py-1.5 pr-2">　</th>
                <th className="py-1.5 pr-2">怎麼算</th>
                <th className="py-1.5 pr-2">到職當月</th>
                <th className="py-1.5">離職當月</th>
              </tr>
            </thead>
            <tbody className="text-ink">
              <tr className="border-b border-line/60">
                <td className="py-1.5 pr-2 font-semibold whitespace-nowrap">工資</td>
                <td className="py-1.5 pr-2">實際在職期間的<span className="font-semibold">上班天數</span></td>
                <td className="py-1.5 pr-2">到職日起算</td>
                <td className="py-1.5">算到離職日</td>
              </tr>
              <tr className="border-b border-line/60">
                <td className="py-1.5 pr-2 font-semibold whitespace-nowrap">勞保、勞退</td>
                <td className="py-1.5 pr-2">
                  按日，<span className="font-semibold">分母固定 30 天</span>（不分大小月）
                </td>
                <td className="py-1.5 pr-2 font-mono text-sm">30 − 到職日 + 1</td>
                <td className="py-1.5 font-mono text-sm">＝ 離職日</td>
              </tr>
              <tr>
                <td className="py-1.5 pr-2 font-semibold whitespace-nowrap">健保</td>
                <td className="py-1.5 pr-2">
                  <span className="font-semibold">不按日</span>，整月計收，由「當月最後一天」的投保單位負擔
                </td>
                <td className="py-1.5 pr-2">照收整月</td>
                <td className="py-1.5">月中走＝不收<br />月底走＝收整月</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-sm text-ink-3">
          例：9/8 到職 → 工資按 9/8 起的上班天數；勞保勞退 30−8+1 ＝{" "}
          <span className="font-semibold">23 天</span>；健保照收整月。<br />
          例：9/15 離職 → 勞保勞退 <span className="font-semibold">15 天</span>；
          健保<span className="font-semibold">這個月不扣</span>（由他下一個投保單位收）。<br />
          ⚠️ 2 月要小心：2/2 到職做到 2/28（月底）是{" "}
          <span className="font-semibold">29 天</span>不是 27 天——分母是 30，做到月底就算到第 30 天。
        </p>
      </Card>

      <Card className="p-3">
        <SectionTitle>員工可以選的只有兩件事</SectionTitle>
        <ol className="list-decimal space-y-2 pl-5 text-base text-ink">
          <li>
            <span className="font-semibold">勞退自願提繳 0–6%</span>（可以只提 1~5%）
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-ink-3">
              <li>提繳的部分<span className="font-semibold">不計入當年度所得課稅</span>，加上雇主的 {num(d.pension_employer_rate)}% 共進個人專戶</li>
              <li>收益有保障：不低於當地銀行 2 年定存利率</li>
              <li>
                缺點是當下可支配所得變少。
                <span className="font-semibold">年所得低於免稅門檻的人沒有節稅效益</span>——
                一般建議稅率 12% 以上才划算
              </li>
            </ul>
          </li>
          <li>
            <span className="font-semibold">健保眷屬加保</span>
            （無職業的配偶、直系尊親屬、未成年或無謀生能力的子女）
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-ink-3">
              <li>每一口各算一份（{nt(healthOne)} 元／口），眷屬超過 {d.health_max_dependents} 口以 {d.health_max_dependents} 口計</li>
              <li>公司負擔不會因此增加，多的全由員工自己付</li>
            </ul>
          </li>
        </ol>
        <p className="mt-2 text-sm text-ink-3">
          <span className="font-semibold">投保級距不是可以選的</span>——
          依法要按實際月薪資總額申報，高報低報都違法。但「薪資總額」含加班費與津貼，
          所以長期加班的人級距會往上跑，自付額跟著變多。
        </p>
      </Card>
    </div>
  );
}

// ── 級距：政府公告的原檔 ───────────────────────────────────────────
function GradeTab() {
  const refs = usePayrollReferences();
  const grades = useInsuranceGrades();

  return (
    <div className="space-y-3">
      <Card className="p-3">
        <SectionTitle>政府公告的級距表</SectionTitle>
        <p className="mb-2 text-sm text-ink-3">
          系統算出來的每一筆保費，最後都要對得上這三份公告。
          這裡只放<span className="font-semibold">官方頁面連結</span>、不留 PDF 副本——
          法規每年修，留副本就會有「系統裡那份是舊的」的問題，那比多點一次連結危險。
        </p>
        {refs.isLoading ? (
          <Spinner />
        ) : (
          <ul className="space-y-2">
            {(refs.data ?? []).map((doc) => (
              <li key={doc.key} className="rounded-lg bg-page p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-base font-bold text-ink">{doc.title}</span>
                  <span className="text-sm text-ink-3">
                    {doc.issuer}　{doc.effective} 起適用
                  </span>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-ink-3">{doc.note}</p>
                <a
                  href={doc.source}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5
                             text-base font-semibold text-ink-2 ring-1 ring-line hover:bg-card"
                >
                  <ExternalLink size={15} />
                  官方頁面
                </a>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-sm text-ink-3">
          明年公告新版時，這幾個連結通常不用改（是分類頁不是特定年度的檔案）。
          真正要改的是「參數設定」裡的費率與「級距」下面那張表。
        </p>
      </Card>

      <Card className="p-3">
        <SectionTitle>系統採用的投保級距</SectionTitle>
        <p className="mb-2 text-sm text-ink-3">
          「員工設定」的投保薪資下拉就是這張表。跟上面的勞保公告一致；
          級距每年跟著基本工資調，可以在這裡改。
        </p>
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
          {(grades.data ?? []).map((g) => (
            <div key={g.id} className="rounded-lg bg-page px-2 py-1.5 text-base">
              <span className="text-sm text-ink-3">第 {g.level} 級</span>
              <span className="ml-2 font-semibold tabular-nums text-ink">{nt(g.amount)}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function PolicyTab() {
  const policy = usePayrollPolicy();
  const save = useSavePolicy();
  const toast = useToast();

  if (policy.isLoading) return <Spinner />;
  if (policy.error) return <ErrorState error={policy.error} onRetry={() => policy.refetch()} />;
  const data = policy.data!;

  const commit = (field: string, raw: string) =>
    save.mutate({ [field]: raw } as never, {
      onSuccess: () => toast.success("已更新，記得回月薪資按「重算薪資」"),
      onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "存檔失敗"),
    });

  return (
    <div className="space-y-3">
      <Card className="p-3">
        <p className="text-base font-bold text-ink">{data.name}</p>
        <p className="mt-1 text-sm text-ink-3">
          這裡的每一個數字都可以改——法規每年會動，改完存檔立刻生效。
          <span className="font-semibold">已確認的月份不受影響</span>
          ：每個月在確認時會把當下的參數整組凍結起來，回頭看得到當時用的是什麼數字。
        </p>
      </Card>

      {POLICY_GROUPS.map((group) => (
        <Card key={group.title} className="p-3">
          <SectionTitle>{group.title}</SectionTitle>
          <p className="mb-2 text-sm text-ink-3">{group.note}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {group.fields.map(([field, label, hint]) => (
              <label key={field} className="block">
                <span className="mb-1 block text-sm text-ink-3">{label}</span>
                <NumberInput
                  value={(data as unknown as Record<string, string>)[field]}
                  onCommit={(v) => commit(field, v)}
                />
                {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
              </label>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

// ── 頁面 ───────────────────────────────────────────────────────────
function SettingsAndLawTab() {
  const [sub, setSub] = useState("policy");
  return (
    <div className="space-y-3">
      <Segmented
        value={sub}
        onChange={setSub}
        options={[
          { value: "policy", label: "參數設定" },
          { value: "law", label: "法規說明" },
          { value: "grade", label: "級距" },
          { value: "calendar", label: "行事曆" },
        ]}
      />
      {sub === "policy" && <PolicyTab />}
      {sub === "law" && <LawTab />}
      {sub === "grade" && <GradeTab />}
      {sub === "calendar" && <CalendarTab />}
    </div>
  );
}

export default function Payroll() {
  const [tab, setTab] = useState("period");

  return (
    <div className="space-y-3">
      <Segmented
        value={tab}
        onChange={setTab}
        grow
        options={[
          { value: "period", label: "月薪資" },
          { value: "profile", label: "員工設定" },
          { value: "policy", label: "設定與法規" },
        ]}
      />
      {tab === "period" && <PeriodTab />}
      {tab === "profile" && <ProfileTab />}
      {tab === "policy" && <SettingsAndLawTab />}
    </div>
  );
}
