import { Loader2 } from "lucide-react";
import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { useCurrentUser } from "@/api/hooks/useAuth";
import AppShell from "@/components/layout/AppShell";
import { ToastProvider } from "@/components/ui/Toast";
import Login from "@/pages/Login";

/**
 * 路由——六個分頁，各回答一個問題：
 *   總覽：今天有什麼要處理　　專案：這個案子進行到哪
 *   追蹤看板：東西卡在哪一步　我的任務：今天輪到我做什麼
 *   金流：錢進來、錢出去、會不會缺　　設定：基礎資料
 *
 * 分頁由後端的 `visible_nav` 決定——員工登入只看得到看板與我的任務，
 * 檢視角色的路由表裡根本沒有 /finance，不是「有但擋住」。
 * 全部 lazy 載入，用不到的頁不下載。
 */
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Projects = lazy(() => import("@/pages/Projects"));
const TrackingBoard = lazy(() => import("@/pages/TrackingBoard"));
const MyWork = lazy(() => import("@/pages/MyWork"));
const Finance = lazy(() => import("@/pages/Finance"));
const Settings = lazy(() => import("@/pages/Settings"));

const SCREENS: Record<string, React.ComponentType> = {
  dashboard: Dashboard,
  projects: Projects,
  tracking: TrackingBoard,
  mywork: MyWork,
  finance: Finance,
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
