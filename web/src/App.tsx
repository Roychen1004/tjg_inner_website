import { Loader2 } from "lucide-react";
import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { useCurrentUser } from "@/api/hooks/useAuth";
import AppShell from "@/components/layout/AppShell";
import { ToastProvider } from "@/components/ui/Toast";
import Login from "@/pages/Login";
import MyWork from "@/pages/MyWork";

/**
 * 路由
 *
 * 分頁由後端的 `visible_nav` 決定——現場人員的路由表裡根本沒有 /billing，
 * 不是「有但擋住」。前端不重寫一次「哪個角色能看什麼」的邏輯。
 *
 * 除了「我的工作」外全部 lazy 載入：現場人員只會用到那一頁，
 * 沒必要讓他的手機下載儀表板與看板的程式碼。
 */
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Projects = lazy(() => import("@/pages/Projects"));
const TrackingBoard = lazy(() => import("@/pages/TrackingBoard"));
const Billing = lazy(() => import("@/pages/Billing"));
const Assets = lazy(() => import("@/pages/Assets"));
const Lines = lazy(() => import("@/pages/Lines"));
const Settings = lazy(() => import("@/pages/Settings"));

const SCREENS: Record<string, React.ComponentType> = {
  "my-work": MyWork,
  dashboard: Dashboard,
  projects: Projects,
  tracking: TrackingBoard,
  billing: Billing,
  assets: Assets,
  lines: Lines,
  settings: Settings,
};

function Loading() {
  return (
    <div className="flex min-h-[40dvh] items-center justify-center text-ink-3">
      <Loader2 size={20} className="mr-2 animate-spin" />
      載入中…
    </div>
  );
}

export default function App() {
  const { data: user, isLoading } = useCurrentUser();

  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-ink-3">
        <Loader2 size={20} className="mr-2 animate-spin" />
        載入中…
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  return (
    <ToastProvider>
      <Routes>
        <Route element={<AppShell user={user} />}>
          {user.visible_nav
            .filter((path) => path in SCREENS)
            .map((path) => {
              const Screen = SCREENS[path];
              return (
                <Route
                  key={path}
                  path={path}
                  element={
                    <Suspense fallback={<Loading />}>
                      <Screen />
                    </Suspense>
                  }
                />
              );
            })}
          {/* 登入後導向哪裡由後端決定 */}
          <Route path="*" element={<Navigate to={user.default_route} replace />} />
        </Route>
      </Routes>
    </ToastProvider>
  );
}
