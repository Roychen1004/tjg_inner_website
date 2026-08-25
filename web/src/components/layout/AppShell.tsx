import {
  Bell,
  Boxes,
  Building2,
  ClipboardCheck,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  SlidersHorizontal,
  Wallet,
} from "lucide-react";
import type { ComponentType } from "react";
import { useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";

import { useMarkNotificationsRead, useNotifications } from "@/api/hooks";
import { type CurrentUser, useLogout } from "@/api/hooks/useAuth";
import { Modal } from "@/components/ui";

/**
 * 導航分頁——五個，各回答一個問題。
 * 實際顯示哪幾個由後端的 visible_nav 決定：
 * 檢視角色看不到「金流」，分頁根本不出現（不是 disable）。
 */
const NAV_ITEMS: Array<{
  key: string;
  label: string;
  icon: ComponentType<{ size?: number | string }>;
}> = [
  { key: "dashboard", label: "總覽", icon: LayoutDashboard },
  { key: "projects", label: "專案", icon: FolderKanban },
  { key: "tracking", label: "追蹤看板", icon: Boxes },
  { key: "mywork", label: "我的任務", icon: ClipboardCheck },
  { key: "finance", label: "金流", icon: Wallet },
  { key: "settings", label: "設定", icon: SlidersHorizontal },
];

export default function AppShell({ user }: { user: CurrentUser }) {
  const logout = useLogout();
  const [showNotifications, setShowNotifications] = useState(false);
  const { data: notifications } = useNotifications();
  const markRead = useMarkNotificationsRead();

  const items = NAV_ITEMS.filter((item) => user.visible_nav.includes(item.key));
  const unread = notifications?.unread_count ?? 0;

  return (
    <div className="min-h-dvh bg-page">
      <header
        style={{
          background: "linear-gradient(135deg, var(--color-brand-from), var(--color-brand-to))",
          borderBottom: "3px solid var(--color-brand-accent)",
        }}
      >
        <div className="mx-auto max-w-6xl px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <Building2 size={20} className="shrink-0 text-brand-accent" />
              <div className="min-w-0">
                <h1 className="truncate text-base font-bold text-white sm:text-lg">
                  鐵正綱工程
                </h1>
                <p className="hidden text-xs text-slate-400 sm:block">內部管理系統</p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => setShowNotifications(true)}
                aria-label={unread ? `通知（${unread} 則未讀）` : "通知"}
                className="relative rounded-lg p-2 text-slate-300 transition-base hover:bg-white/10"
              >
                <Bell size={18} />
                {unread > 0 && (
                  <span
                    className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center
                               rounded-full px-1 text-[10px] font-bold text-white"
                    style={{ background: "var(--color-delayed)" }}
                  >
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </button>
              <div className="hidden px-2 text-right sm:block">
                <p className="text-sm font-semibold text-white">{user.name}</p>
                <p className="text-xs text-slate-400">{user.role_labels.join("、")}</p>
              </div>
              <button
                type="button"
                onClick={() => logout.mutate()}
                aria-label="登出"
                className="rounded-lg p-2 text-slate-300 transition-base hover:bg-white/10"
              >
                <LogOut size={18} />
              </button>
            </div>
          </div>

          {items.length > 1 && (
            <nav className="scroll-x mt-3 flex gap-1 pb-1">
              {items.map((item) => (
                <NavLink
                  key={item.key}
                  to={`/${item.key}`}
                  className={({ isActive }) =>
                    [
                      "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2",
                      "text-sm font-semibold transition-base",
                      isActive ? "bg-white text-slate-800" : "text-slate-300 hover:bg-white/10",
                    ].join(" ")
                  }
                >
                  <item.icon size={15} />
                  {item.label}
                </NavLink>
              ))}
            </nav>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-4">
        {/* 頁面不再放大標小標（D40）——導航分頁已經說了你在哪，
            內容直接開始，省一截垂直空間 */}
        <Outlet />
      </main>

      <Modal
        open={showNotifications}
        onClose={() => setShowNotifications(false)}
        title="通知"
        footer={
          unread > 0 ? (
            <button
              type="button"
              onClick={() => markRead.mutate(undefined)}
              className="w-full rounded-lg bg-page py-2 text-sm font-semibold text-ink-2"
            >
              全部標記為已讀
            </button>
          ) : undefined
        }
      >
        {!notifications?.results.length ? (
          <p className="py-8 text-center text-sm text-ink-3">目前沒有通知</p>
        ) : (
          <ul className="space-y-2">
            {notifications.results.map((item) => (
              <li key={item.id}>
                <Link
                  to={item.link_url || "#"}
                  onClick={() => {
                    if (!item.is_read) markRead.mutate(item.id);
                    setShowNotifications(false);
                  }}
                  className="block rounded-lg px-3 py-2 transition-base hover:bg-page"
                  style={{ background: item.is_read ? undefined : "var(--color-page)" }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-ink">{item.title}</p>
                    {!item.is_read && (
                      <span
                        aria-label="未讀"
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                        style={{ background: "var(--color-delayed)" }}
                      />
                    )}
                  </div>
                  {item.body && (
                    <p className="mt-0.5 whitespace-pre-line text-xs leading-snug text-ink-2">
                      {item.body}
                    </p>
                  )}
                  <p className="mt-1 text-[11px] text-ink-3">
                    {item.category_label} · {new Date(item.created_at).toLocaleString("zh-TW")}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}
