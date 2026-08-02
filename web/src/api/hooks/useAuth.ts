import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError, api } from "../client";
import type { components } from "../schema";

/**
 * 由 OpenAPI 自動產生（make api-types），**完全不手寫**
 *
 * ★ 這是型別安全的關鍵：後端改了 CurrentUserSerializer 的欄位，
 * 重新產生型別後，前端用到舊欄位的地方會立刻編譯失敗——
 * 而不是等到上線才發現。
 *
 * `permissions` 是功能權限對照表（前端據此決定按鈕顯不顯示，
 * 真正的攔截在後端）；`visible_nav` 決定看得到哪些分頁；
 * `default_route` 決定登入後去哪——三者都由後端算好，
 * 前端不重寫一次「哪個角色能做什麼」的邏輯。
 */
export type CurrentUser = components["schemas"]["CurrentUser"];

const ME_KEY = ["auth", "me"] as const;

export function useCurrentUser() {
  return useQuery<CurrentUser | null>({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return await api.get<CurrentUser>("/auth/me");
      } catch (error) {
        // 未登入不是錯誤，是一種狀態
        if (error instanceof ApiError && error.isAuthError) return null;
        throw error;
      }
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (credentials: { username: string; password: string }) =>
      api.post<CurrentUser>("/auth/login", credentials),
    onSuccess: (user) => queryClient.setQueryData(ME_KEY, user),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<void>("/auth/logout"),
    onSuccess: () => {
      queryClient.setQueryData(ME_KEY, null);
      queryClient.clear();
    },
  });
}

export function useChangePassword() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      old_password: string;
      new_password: string;
      confirm_password: string;
    }) => api.post<CurrentUser>("/auth/change-password", payload),
    onSuccess: (user) => queryClient.setQueryData(ME_KEY, user),
  });
}

/** 判斷是否具備某項功能權限。找不到的權限一律視為沒有。 */
export function can(user: CurrentUser | null | undefined, permission: string): boolean {
  return Boolean(user?.permissions?.[permission]);
}
