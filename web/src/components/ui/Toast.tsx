/**
 * 提示訊息
 *
 * 存在的理由只有一個：**讓使用者知道剛才那一按發生了什麼**。
 *
 * 推進一個階段可能同時觸發請款、轉為待簽收、把狀態改成「注意」。
 * 這些副作用如果不講，使用者只會看到畫面閃一下——
 * 然後在月底對帳時才發現有筆錢自己冒出來。
 */
import { CheckCircle2, Info, X } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

import { SeverityIcon, type Severity } from "./index";

interface Toast {
  id: number;
  severity: Severity;
  title: string;
  lines: string[];
}

interface ToastApi {
  show: (title: string, options?: { severity?: Severity; lines?: string[] }) => void;
  success: (title: string, lines?: string[]) => void;
  warn: (title: string, lines?: string[]) => void;
  error: (title: string, lines?: string[]) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast 必須在 ToastProvider 內使用");
  return api;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const show = useCallback<ToastApi["show"]>(
    (title, options = {}) => {
      const id = nextId.current++;
      const severity = options.severity ?? "good";
      setToasts((list) => [...list, { id, severity, title, lines: options.lines ?? [] }]);
      // 警告與錯誤留久一點——那是使用者需要讀完的
      const ttl = severity === "bad" ? 9000 : severity === "warn" ? 7000 : 4000;
      setTimeout(() => dismiss(id), ttl);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (title, lines) => show(title, { severity: "good", lines }),
      warn: (title, lines) => show(title, { severity: "warn", lines }),
      error: (title, lines) => show(title, { severity: "bad", lines }),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col
                   items-center gap-2 px-4 pb-4 sm:inset-x-auto sm:right-4 sm:items-end"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className="pointer-events-auto flex w-full max-w-md gap-2 rounded-xl bg-card
                       px-3 py-2.5 shadow-lg ring-1 ring-line"
          >
            <span className="mt-0.5 shrink-0">
              <SeverityIcon severity={toast.severity} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">{toast.title}</p>
              {toast.lines.map((line, i) => (
                <p key={i} className="mt-0.5 text-xs leading-snug text-ink-2">
                  {line}
                </p>
              ))}
            </div>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="關閉提示"
              className="-mr-1 h-6 min-h-0 shrink-0 self-start rounded p-1 text-ink-3 hover:bg-page"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** 把 API 回傳的副作用整理成提示。所有變更操作共用同一套解讀規則。 */
export function describeSideEffects(result: {
  warnings?: string[];
  next_action?: { message: string } | null;
  status_changed?: { reason: string; to: string } | null;
  billing?: { triggered: boolean; reason: string; claim?: { amount: string; milestone: string } };
}): { severity: Severity; lines: string[] } {
  const lines: string[] = [];
  let severity: Severity = "good";

  if (result.billing?.triggered) {
    const claim = result.billing.claim;
    lines.push(
      claim
        ? `已觸發請款：${claim.milestone} ${Number(claim.amount).toLocaleString("zh-TW")} 元`
        : `已觸發請款：${result.billing.reason}`,
    );
  } else if (result.billing) {
    lines.push(result.billing.reason);
  }

  if (result.next_action) lines.push(result.next_action.message);

  if (result.status_changed) {
    severity = result.status_changed.to === "delayed" ? "bad" : "warn";
    lines.push(`狀態轉為「${result.status_changed.to === "delayed" ? "延誤" : "注意"}」：${result.status_changed.reason}`);
  }

  for (const w of result.warnings ?? []) {
    severity = severity === "bad" ? "bad" : "warn";
    lines.push(w);
  }
  return { severity, lines };
}

export { CheckCircle2, Info };
