/**
 * 共用元件
 *
 * 依 docs/開發/04_UI設計原則.md 的第一性原理：
 *   · 狀態用燈號＋一個字，不寫整句話
 *   · 顏色永遠伴隨文字或圖示，不單靠顏色傳達資訊（色盲安全）
 *   · 沒有裝飾性元素——每個元件都在回答一個問題
 *
 * 全部集中在一個檔案，因為它們都很小。拆成 14 個檔案只會讓人多開 14 次檔案。
 */
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Info,
  Loader2,
  Search,
  X,
  XCircle,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import type { StatusCode } from "@/api/types";

// ── 狀態燈號 ───────────────────────────────────────────────────────
const STATUS_META: Record<StatusCode, { label: string; fg: string; bg: string }> = {
  ontrack: { label: "正常", fg: "var(--color-ontrack)", bg: "var(--color-ontrack-bg)" },
  atrisk: { label: "注意", fg: "var(--color-atrisk)", bg: "var(--color-atrisk-bg)" },
  delayed: { label: "延誤", fg: "var(--color-delayed)", bg: "var(--color-delayed-bg)" },
};

export function StatusBadge({ status, size = "sm" }: { status: StatusCode; size?: "sm" | "xs" }) {
  const meta = STATUS_META[status] ?? STATUS_META.ontrack;
  return (
    <span
      className={[
        "inline-flex shrink-0 items-center gap-1 rounded-full font-semibold",
        size === "xs" ? "px-1.5 py-0.5 text-xs" : "px-2 py-0.5 text-xs",
      ].join(" ")}
      style={{ color: meta.fg, background: meta.bg }}
    >
      {/* 圓點是給色覺不同的人的第二重編碼；文字是第三重 */}
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: meta.fg }}
      />
      {meta.label}
    </span>
  );
}

const SEVERITY_META = {
  bad: { icon: XCircle, fg: "var(--color-delayed)", bg: "var(--color-delayed-bg)" },
  warn: { icon: AlertTriangle, fg: "var(--color-atrisk)", bg: "var(--color-atrisk-bg)" },
  good: { icon: CheckCircle2, fg: "var(--color-ontrack)", bg: "var(--color-ontrack-bg)" },
  info: { icon: Info, fg: "var(--color-ink-2)", bg: "var(--color-page)" },
  neutral: { icon: Info, fg: "var(--color-ink-2)", bg: "var(--color-page)" },
} as const;

export type Severity = keyof typeof SEVERITY_META;

export function SeverityIcon({ severity, size = 16 }: { severity: Severity; size?: number }) {
  const meta = SEVERITY_META[severity] ?? SEVERITY_META.info;
  const Icon = meta.icon;
  return <Icon size={size} style={{ color: meta.fg }} />;
}

// ── 進度條 ─────────────────────────────────────────────────────────
export function ProgressBar({
  value,
  label,
  color,
  compact = false,
}: {
  value: number;
  label?: string;
  color?: string;
  compact?: boolean;
}) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div>
      {label && (
        <div className="mb-1 flex items-baseline justify-between text-xs">
          <span className="text-ink-2">{label}</span>
          <span className="font-semibold tabular-nums text-ink">{pct.toFixed(0)}%</span>
        </div>
      )}
      <div
        className={compact ? "h-1.5 rounded-full bg-line" : "h-2 rounded-full bg-line"}
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full transition-base"
          style={{ width: `${pct}%`, background: color ?? "var(--color-stage-2)" }}
        />
      </div>
    </div>
  );
}

// ── 階段軌道 ───────────────────────────────────────────────────────
export function StageTrack({
  current,
  total,
  name,
  color,
}: {
  current: number;
  total: number;
  name?: string;
  color?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="truncate font-semibold text-ink">{name}</span>
        <span className="shrink-0 tabular-nums text-ink-3">
          {current} / {total}
        </span>
      </div>
      <div className="mt-1 flex gap-0.5" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <div
            key={i}
            className="h-1 flex-1 rounded-full"
            style={{
              background: i < current ? (color ?? "var(--color-stage-2)") : "var(--color-line)",
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ── 卡片與版面 ─────────────────────────────────────────────────────
export function Card({
  children,
  className = "",
  as = "div",
  ...rest
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article" | "li";
  /** React 19 起 ref 是普通 prop，直接往下傳即可，不需要 forwardRef */
  ref?: React.Ref<HTMLElement>;
} & React.HTMLAttributes<HTMLElement>) {
  // 轉成 ElementType，TS 才不會把 props 窄化到某一個具體標籤
  const Tag = as as React.ElementType;
  return (
    <Tag className={`rounded-xl bg-card ring-1 ring-line ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

export function SectionTitle({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <h2 className="text-sm font-bold text-ink">{children}</h2>
      {action}
    </div>
  );
}

// ── KPI 卡片 ───────────────────────────────────────────────────────
export function KpiCard({
  label,
  value,
  unit,
  status = "neutral",
  detail,
}: {
  label: string;
  value: number | string;
  unit?: string;
  status?: Severity;
  detail?: string;
}) {
  const meta = SEVERITY_META[status] ?? SEVERITY_META.neutral;
  return (
    <Card className="p-3">
      <p className="text-xs font-semibold text-ink-2">{label}</p>
      <p className="mt-1 flex items-baseline gap-1">
        <span
          className="text-2xl font-bold tabular-nums"
          style={{ color: status === "neutral" ? "var(--color-ink)" : meta.fg }}
        >
          {value}
        </span>
        {unit && <span className="text-xs text-ink-3">{unit}</span>}
      </p>
      {detail && <p className="mt-1 text-xs leading-snug text-ink-3">{detail}</p>}
    </Card>
  );
}

// ── 金額 ───────────────────────────────────────────────────────────
/**
 * null 代表「沒有權限看」，不是 0。
 * 顯示 ── 而不是 0，因為 0 是一個會被誤信的數字。
 */
export function Money({
  value,
  className = "",
  compact = false,
}: {
  value: string | number | null | undefined;
  className?: string;
  compact?: boolean;
}) {
  if (value === null || value === undefined) {
    return (
      <span className={`text-ink-3 ${className}`} title="你的角色看不到金額">
        ──
      </span>
    );
  }
  const num = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(num)) return <span className={className}>{String(value)}</span>;

  if (compact && Math.abs(num) >= 10000) {
    const wan = num / 10000;
    return (
      <span className={`tabular-nums ${className}`}>
        {wan >= 10000 ? `${(wan / 10000).toFixed(2)} 億` : `${wan.toFixed(0)} 萬`}
      </span>
    );
  }
  return <span className={`tabular-nums ${className}`}>{num.toLocaleString("zh-TW")}</span>;
}

// ── 狀態畫面 ───────────────────────────────────────────────────────
export function Spinner({ label = "載入中…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-ink-3">
      <Loader2 size={18} className="animate-spin" />
      {label}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl bg-card px-6 py-12 text-center ring-1 ring-line">
      <p className="text-sm font-semibold text-ink-2">{title}</p>
      {hint && <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-ink-3">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as Error).message)
      : "發生未知錯誤";
  return (
    <div
      role="alert"
      className="rounded-xl px-5 py-6 text-center"
      style={{ background: "var(--color-delayed-bg)", color: "var(--color-delayed)" }}
    >
      <XCircle size={22} className="mx-auto" />
      <p className="mt-2 text-sm font-semibold">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-lg bg-white px-4 py-2 text-xs font-semibold text-ink ring-1 ring-line"
        >
          重新載入
        </button>
      )}
    </div>
  );
}

// ── 表單元件 ───────────────────────────────────────────────────────
export function SearchInput({
  value,
  onChange,
  placeholder = "搜尋…",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative flex-1">
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-line bg-card py-2 pl-9 pr-3 text-sm
                   outline-none focus:border-stage-2 focus:ring-2 focus:ring-stage-2/20"
      />
    </div>
  );
}

export function Select({
  value,
  onChange,
  options,
  placeholder,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string | number; label: string }>;
  placeholder?: string;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink
                  outline-none focus:border-stage-2 ${className}`}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Field({
  label,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-xs font-semibold text-ink-2">
        {label}
        {required && <span style={{ color: "var(--color-delayed)" }}> *</span>}
      </span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
      {error && (
        <span className="mt-1 block text-xs" style={{ color: "var(--color-delayed)" }}>
          {error}
        </span>
      )}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink " +
  "outline-none focus:border-stage-2 focus:ring-2 focus:ring-stage-2/20 disabled:bg-slate-50";

// ── 日期欄位（自製大日曆，D48）────────────────────────────────────
// 原生 input[type=date] 的彈出日曆由瀏覽器決定大小、改不了，老闆嫌太小。
// 自己畫：格子大（40px）、有「今天／清除」，點外面或 Esc 關閉。

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function isoOf(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function DateInput({
  value,
  onChange,
  className = "",
  placeholder = "選日期",
  "aria-label": ariaLabel,
}: {
  /** YYYY-MM-DD，空字串＝未選 */
  value: string;
  onChange: (v: string) => void;
  className?: string;
  placeholder?: string;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  // 顯示中的月份（每月一日）
  const [view, setView] = useState(() => {
    const d = value ? new Date(value) : new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    // capture＋stopPropagation：Esc 只關日曆，不連外層的卡片一起關
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  function toggle() {
    if (!open) {
      const d = value ? new Date(value) : new Date();
      setView(new Date(d.getFullYear(), d.getMonth(), 1));
    }
    setOpen((v) => !v);
  }

  function pick(day: number) {
    onChange(isoOf(view.getFullYear(), view.getMonth(), day));
    setOpen(false);
  }

  const today = new Date();
  const todayIso = isoOf(today.getFullYear(), today.getMonth(), today.getDate());
  const daysInMonth = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const leading = new Date(view.getFullYear(), view.getMonth(), 1).getDay();

  return (
    <div ref={wrap} className={`relative ${className}`}>
      <button
        type="button"
        onClick={toggle}
        aria-label={ariaLabel ?? placeholder}
        aria-expanded={open}
        className={`${inputClass} flex min-h-10 items-center justify-between text-left`}
      >
        <span className={value ? "tabular-nums" : "text-ink-3"}>{value || placeholder}</span>
        <CalendarDays size={16} className="shrink-0 text-ink-3" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-[19rem] rounded-xl bg-card p-2.5 shadow-xl ring-1 ring-line">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setView((v) => new Date(v.getFullYear(), v.getMonth() - 1, 1))}
              aria-label="上個月"
              className="rounded-lg p-1.5 text-ink-2 hover:bg-page"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="text-sm font-bold tabular-nums text-ink">
              {view.getFullYear()} 年 {view.getMonth() + 1} 月
            </span>
            <button
              type="button"
              onClick={() => setView((v) => new Date(v.getFullYear(), v.getMonth() + 1, 1))}
              aria-label="下個月"
              className="rounded-lg p-1.5 text-ink-2 hover:bg-page"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          <div className="mt-1 grid grid-cols-7 text-center text-xs font-semibold text-ink-3">
            {WEEKDAYS.map((w) => (
              <span key={w} className="py-1">
                {w}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {Array.from({ length: leading }, (_, i) => (
              <span key={`b${i}`} />
            ))}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const iso = isoOf(view.getFullYear(), view.getMonth(), i + 1);
              const selected = iso === value;
              const isToday = iso === todayIso;
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => pick(i + 1)}
                  className={[
                    "h-10 rounded-lg text-sm tabular-nums transition-base",
                    selected
                      ? "bg-stage-2 font-bold text-white"
                      : "text-ink hover:bg-page",
                    !selected && isToday ? "ring-1 ring-stage-2" : "",
                  ].join(" ")}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>

          <div className="mt-1.5 flex justify-between border-t border-line pt-1.5">
            <button
              type="button"
              onClick={() => {
                onChange(todayIso);
                setOpen(false);
              }}
              className="rounded-lg px-2 py-1 text-xs font-semibold text-ink-2 hover:bg-page"
            >
              今天
            </button>
            {value && (
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
                className="rounded-lg px-2 py-1 text-xs font-semibold text-ink-3 hover:bg-page"
              >
                清除
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 表單錯誤總結
 *
 * 存在的理由：**沒有任何一個 400 可以是靜默的。**
 * 掛在 non_field_errors、或掛在這張表單沒有渲染的欄位上的錯誤，
 * 全部會出現在這裡——否則使用者按了送出，什麼都沒發生、也沒有紅字。
 */
export function FormErrors({
  error,
  handled = [],
}: {
  error: { otherErrors: (h?: string[]) => string[] } | null | undefined;
  /** 這張表單已經顯示在欄位旁邊的錯誤，不必重複 */
  handled?: string[];
}) {
  const messages = error?.otherErrors(handled) ?? [];
  if (!messages.length) return null;
  return (
    <div
      role="alert"
      className="mb-3 rounded-lg px-3 py-2 text-xs leading-relaxed"
      style={{ background: "var(--color-delayed-bg)", color: "var(--color-delayed)" }}
    >
      {messages.map((m, i) => (
        <p key={i}>{m}</p>
      ))}
    </div>
  );
}

/** 按鈕停用時說明缺什麼。看得到按鈕卻按不下去，是最讓人困惑的狀態 */
export function DisabledHint({ show, children }: { show: boolean; children: ReactNode }) {
  if (!show) return null;
  return <p className="mb-2 text-center text-xs text-ink-3">{children}</p>;
}

// ── 按鈕 ───────────────────────────────────────────────────────────
export function Button({
  children,
  variant = "secondary",
  loading = false,
  className = "",
  ...rest
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  loading?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const isDisabled = Boolean(rest.disabled) || loading;
  const variants = {
    primary: "bg-stage-2 text-white hover:bg-stage-3 disabled:bg-slate-300",
    secondary: "bg-card text-ink ring-1 ring-line hover:bg-page disabled:text-ink-3",
    danger: "text-white",
    ghost: "text-ink-2 hover:bg-page",
  };
  return (
    <button
      type="button"
      {...rest}
      disabled={isDisabled}
      className={[
        "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2",
        "text-sm font-semibold transition-base disabled:cursor-not-allowed",
        variants[variant],
        className,
      ].join(" ")}
      // ⚠️ 行內 style 的優先序高於 Tailwind 的 disabled: 類別。
      // 之前 danger 用行內背景色，停用時看起來仍是鮮紅可按的樣子——
      // 使用者一直點、什麼都沒發生。停用時必須自己把顏色換掉。
      style={
        variant === "danger"
          ? { background: isDisabled ? "var(--color-ink-3)" : "var(--color-delayed)" }
          : undefined
      }
    >
      {loading && <Loader2 size={15} className="animate-spin" />}
      {children}
    </button>
  );
}

// ── 頂排選項（分頁切換）──────────────────────────────────────────
/**
 * D50（老闆）：所有頂排選項（客戶／廠商、應收／應付、流程看板／甘特…）
 * 都要**有邊界**——每個選項一個帶框的按鈕，選中的填藍色。
 * 之前是灰底滑塊樣式，沒選中的選項看起來像純文字，不知道能按。
 */
export function Segmented({
  value,
  onChange,
  options,
  grow = false,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<{ value: string; label: ReactNode }>;
  /** 撐滿一列（主分頁列用）；false＝依內容寬 */
  grow?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={[
              "flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5",
              "text-sm font-semibold transition-base",
              grow ? "flex-1" : "",
              active
                ? "border-stage-2 bg-stage-2 text-white shadow-sm"
                : "border-line bg-card text-ink-2 hover:bg-page",
            ].join(" ")}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ── 對話框 ─────────────────────────────────────────────────────────
/**
 * 手機從底部滑入（拇指容易搆到），桌機置中。
 * 不做動畫特效——只做讓人看得懂「這是暫時蓋在上面的東西」所需的最少視覺。
 *
 * `side`（D47/D48）：改成從**右側**滑出的側欄（桌機約 1/3 螢幕寬），
 * **沒有遮罩**——左邊的頁面照常點選、捲動，跟側欄是同一個平面。
 * 關閉靠 X、Esc 或側欄裡的按鈕。
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  side = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  side?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    // 側欄模式不鎖頁面捲動——左邊要能照常滑動
    if (!side) document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      if (!side) document.body.style.overflow = "";
    };
  }, [open, onClose, side]);

  if (!open) return null;

  if (side) {
    // 無遮罩側欄：頁面照常互動，是同一個平面（D48）
    return (
      <div
        role="dialog"
        aria-label={title}
        className="fixed inset-y-0 right-0 z-50 w-full overflow-y-auto border-l border-line bg-card shadow-2xl sm:w-[max(33vw,420px)]"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-card px-4 py-3">
          <h3 className="text-sm font-bold text-ink">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉"
            className="rounded-lg p-1.5 text-ink-3 hover:bg-page"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-4 py-4">{children}</div>
        {footer && (
          <div className="sticky bottom-0 flex gap-2 border-t border-line bg-card px-4 py-3">
            {footer}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl bg-card sm:max-w-lg sm:rounded-2xl"
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-line bg-card px-4 py-3">
          <h3 className="text-sm font-bold text-ink">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉"
            className="rounded-lg p-1.5 text-ink-3 hover:bg-page"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-4 py-4">{children}</div>
        {footer && (
          <div className="sticky bottom-0 flex gap-2 border-t border-line bg-card px-4 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
