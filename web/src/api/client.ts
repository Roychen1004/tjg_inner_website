/**
 * API client
 *
 * 統一處理三件事：
 *   1. CSRF token（Session Cookie 認證必要）
 *   2. 後端的統一錯誤格式 → 前端可讀的 ApiError
 *   3. credentials: "include"，讓 cookie 跟著送
 */

export const API_BASE = "/api/v0.1";

/** 後端 main/utils/exceptions.py 產生的錯誤格式 */
export interface ApiErrorBody {
  type: string;
  detail: string;
  errors?: Array<{ field: string; code: string; message: string }>;
  context?: Record<string, unknown>;
  hint?: string;
  retry_after?: number;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.detail || "發生錯誤");
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }

  /** 取某個欄位的錯誤訊息，用於表單即時提示 */
  fieldError(field: string): string | undefined {
    return this.body.errors?.find((e) => e.field === field)?.message;
  }

  /**
   * 取「沒有被任何欄位顯示到」的錯誤訊息。
   *
   * ★ 這是為了避免一整類的靜默失敗：後端回了 400，但錯誤掛在
   * `non_field_errors` 或某個表單沒渲染的欄位上，使用者按了送出
   * 什麼事都沒發生、畫面上也沒有紅字。
   *
   * 表單把自己有顯示的欄位傳進來，其餘一律進總結區。
   */
  otherErrors(handled: string[] = []): string[] {
    const covered = new Set(handled);
    const rest = (this.body.errors ?? [])
      .filter((e) => !covered.has(e.field))
      .map((e) => (e.field === "non_field_errors" ? e.message : `${e.field}：${e.message}`));
    // 完全沒有欄位級錯誤時，至少要把 detail 顯示出來
    if (!this.body.errors?.length && this.body.detail) return [this.body.detail];
    return rest;
  }

  get isAuthError() {
    return this.status === 401;
  }

  /** 需要二次確認（如結案時尚有未收款） */
  get needsConfirmation() {
    return this.body.type === "confirmation_required";
  }
}

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[2]) : null;
}

let csrfReady: Promise<void> | null = null;

/** 確保 csrftoken cookie 存在。多處同時呼叫只會實際請求一次。 */
export function ensureCsrf(): Promise<void> {
  if (readCookie("csrftoken")) return Promise.resolve();
  if (!csrfReady) {
    csrfReady = fetch(`${API_BASE}/auth/csrf`, { credentials: "include" })
      .then(() => undefined)
      .finally(() => {
        csrfReady = null;
      });
  }
  return csrfReady;
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, query, headers, method = "GET", ...rest } = options;
  const isWrite = !["GET", "HEAD", "OPTIONS"].includes(method);

  if (isWrite) await ensureCsrf();

  let url = `${API_BASE}${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") params.append(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const response = await fetch(url, {
    ...rest,
    method,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(isWrite ? { "X-CSRFToken": readCookie("csrftoken") ?? "" } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      data ?? { type: "server_error", detail: "系統發生錯誤，請聯絡管理員" },
    );
  }
  return data as T;
}

/**
 * 檔案上傳
 *
 * 不能走上面的 `request`：那裡一律 `JSON.stringify(body)` 並設
 * `Content-Type: application/json`。multipart 的 boundary 必須由瀏覽器
 * 自己產生，**手動設 Content-Type 反而會讓後端解不出檔案**。
 */
export async function upload<T>(path: string, form: FormData): Promise<T> {
  await ensureCsrf();
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "X-CSRFToken": readCookie("csrftoken") ?? "" },
    body: form,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new ApiError(
      response.status,
      data ?? { type: "server_error", detail: "上傳失敗，請稍後再試" },
    );
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, query?: RequestOptions["query"]) =>
    request<T>(path, { method: "GET", query }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  upload,
};
