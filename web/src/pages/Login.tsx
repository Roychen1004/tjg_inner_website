import { Building2, Loader2 } from "lucide-react";
import { useState } from "react";

import { ApiError } from "@/api/client";
import { useLogin } from "@/api/hooks/useAuth";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const login = useLogin();

  const error = login.error instanceof ApiError ? login.error : null;
  const isLocked = error?.status === 429;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!username.trim() || !password) return;
    login.mutate({ username: username.trim(), password });
  }

  return (
    <div className="flex min-h-dvh flex-col bg-page">
      <header
        className="px-5 py-6"
        style={{
          background: "linear-gradient(135deg, var(--color-brand-from), var(--color-brand-to))",
          borderBottom: "3px solid var(--color-brand-accent)",
        }}
      >
        <div className="mx-auto flex max-w-md items-center gap-2">
          <Building2 size={22} className="text-brand-accent" />
          <div>
            <h1 className="text-lg font-bold text-white">鐵正綱工程</h1>
            <p className="mt-0.5 text-xs text-slate-400">內部管理系統</p>
          </div>
        </div>
      </header>

      <main className="flex flex-1 items-start justify-center px-5 py-10 sm:items-center sm:py-0">
        <form onSubmit={handleSubmit} className="w-full max-w-md">
          <div className="rounded-2xl bg-card p-6 shadow-sm ring-1 ring-line">
            <h2 className="mb-6 text-base font-bold text-ink">登入</h2>

            <label className="mb-4 block">
              <span className="mb-1.5 block text-xs font-semibold text-ink-2">帳號</span>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                disabled={login.isPending || isLocked}
                className="w-full rounded-lg border border-line bg-white px-3 py-2.5 text-ink
                           outline-none focus:border-stage-2 focus:ring-2 focus:ring-stage-2/20
                           disabled:bg-slate-50"
              />
            </label>

            <label className="mb-2 block">
              <span className="mb-1.5 block text-xs font-semibold text-ink-2">密碼</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                disabled={login.isPending || isLocked}
                className="w-full rounded-lg border border-line bg-white px-3 py-2.5 text-ink
                           outline-none focus:border-stage-2 focus:ring-2 focus:ring-stage-2/20
                           disabled:bg-slate-50"
              />
            </label>

            {error && (
              <p
                role="alert"
                className="mt-3 rounded-lg px-3 py-2.5 text-sm"
                style={{
                  background: "var(--color-delayed-bg)",
                  color: "var(--color-delayed)",
                }}
              >
                {error.body.detail}
              </p>
            )}

            <button
              type="submit"
              disabled={login.isPending || isLocked || !username.trim() || !password}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg
                         bg-stage-2 py-3 text-sm font-bold text-white transition-base
                         hover:bg-stage-3 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {login.isPending && <Loader2 size={16} className="animate-spin" />}
              {login.isPending ? "登入中…" : "登入"}
            </button>
          </div>

          <p className="mt-5 text-center text-xs text-ink-3">
            忘記密碼或帳號被鎖定，請聯絡系統管理員
          </p>
        </form>
      </main>
    </div>
  );
}
