/**
 * 共用元件
 *
 * 依 docs/08_UI設計原則.md 的第一性原理：
 *   · 狀態用燈號＋一個字，不寫整句話
 *   · 顏色永遠伴隨文字或圖示，不單靠顏色傳達資訊（色盲安全）
 *   · 沒有裝飾性元素——每個元件都在回答一個問題
 *
 * 全部集中在一個檔案，因為它們都很小。拆成 14 個檔案只會讓人多開 14 次檔案。
 */
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  Search,
  X,
  XCircle,
} from "lucide-react";
import { type ReactNode, useEffect } from "react";

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
        size === "xs" ? "px-1.5 py-0.5 text-[11px]" : "px-2 py-0.5 text-xs",
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
      {detail && <p className="mt-1 text-[11px] leading-snug text-ink-3">{detail}</p>}
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
      {hint && !error && <span className="mt-1 block text-[11px] text-ink-3">{hint}</span>}
      {error && (
        <span className="mt-1 block text-[11px]" style={{ color: "var(--color-delayed)" }}>
          {error}
        </span>
      )}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink " +
  "outline-none focus:border-stage-2 focus:ring-2 focus:ring-stage-2/20 disabled:bg-slate-50";

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
  return <p className="mb-2 text-center text-[11px] text-ink-3">{children}</p>;
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

// ── 對話框 ─────────────────────────────────────────────────────────
/**
 * 手機從底部滑入（拇指容易搆到），桌機置中。
 * 不做動畫特效——只做讓人看得懂「這是暫時蓋在上面的東西」所需的最少視覺。
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

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
        className="max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl bg-card
                   sm:max-w-lg sm:rounded-2xl"
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
