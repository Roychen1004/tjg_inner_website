/**
 * 資料存取 hooks
 *
 * 兩條規則：
 *   1. 每個查詢都有明確的 queryKey，變更後只 invalidate 受影響的部分
 *      —— 不要每次操作都 clear 全部快取，那等於沒有快取
 *   2. 變更操作回傳完整的副作用，由呼叫端決定怎麼顯示
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../client";
import type {
  AssetSummary,
  AssetUnit,
  AttentionData,
  Activity,
  BillingSummary,
  BoardData,
  Claim,
  DashboardOverview,
  LinesData,
  Lot,
  Milestone,
  MoveStageResult,
  MyWorkData,
  Notification,
  OptionsData,
  Paginated,
  ProjectDetail,
  ProjectRow,
  ProjectSummary,
  ReportProgressResult,
  SignoffResult,
  TrackingCard,
  TrackingDetail,
} from "../types";

type Params = Record<string, string | number | boolean | undefined | null>;

/** 篩選條件直接當 queryKey 的一部分——換條件就是換一份資料 */
const key = (...parts: unknown[]) => parts;

// ── 選項（幾乎不變，快取久一點）────────────────────────────────────
export function useOptions() {
  return useQuery({
    queryKey: key("options"),
    queryFn: () => api.get<OptionsData>("/options"),
    staleTime: 30 * 60 * 1000,
  });
}

// ── 儀表板 ─────────────────────────────────────────────────────────
export function useDashboard() {
  return useQuery({
    queryKey: key("dashboard", "overview"),
    queryFn: () => api.get<DashboardOverview>("/dashboard/overview"),
    staleTime: 60 * 1000,
  });
}

export function useAttention() {
  return useQuery({
    queryKey: key("dashboard", "attention"),
    queryFn: () => api.get<AttentionData>("/dashboard/attention"),
    staleTime: 60 * 1000,
  });
}

export function useActivities(limit = 15) {
  return useQuery({
    queryKey: key("dashboard", "activities", limit),
    queryFn: () => api.get<Activity[]>("/dashboard/activities", { limit }),
    staleTime: 60 * 1000,
  });
}

// ── 專案 ───────────────────────────────────────────────────────────
export function useProjects(params: Params = {}) {
  return useQuery({
    queryKey: key("projects", params),
    queryFn: () => api.get<Paginated<ProjectRow>>("/projects", params),
  });
}

export function useProject(id: number | null) {
  return useQuery({
    queryKey: key("project", id),
    queryFn: () => api.get<ProjectDetail>(`/projects/${id}`),
    enabled: id !== null,
  });
}

export function useProjectSummary(id: number | null) {
  return useQuery({
    queryKey: key("project", id, "summary"),
    queryFn: () => api.get<ProjectSummary>(`/projects/${id}/summary`),
    enabled: id !== null,
  });
}

export function useAdvanceProject(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { direction: "forward" | "backward"; note?: string; confirmed?: boolean }) =>
      api.post<{ project: ProjectDetail; warnings: string[] }>(
        `/projects/${id}/advance-stage`,
        body,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key("project", id) });
      qc.invalidateQueries({ queryKey: key("projects") });
      qc.invalidateQueries({ queryKey: key("dashboard") });
    },
  });
}

// ── 追蹤單元 ───────────────────────────────────────────────────────
export function useTrackingUnits(params: Params = {}, enabled = true) {
  return useQuery({
    queryKey: key("tracking-units", params),
    queryFn: () => api.get<Paginated<TrackingCard>>("/tracking-units", params),
    enabled,
  });
}

export function useBoard(params: Params, enabled = true) {
  return useQuery({
    queryKey: key("board", params),
    queryFn: () => api.get<BoardData>("/tracking-units/board", params),
    enabled,
  });
}

export function useTrackingUnit(id: number | null) {
  return useQuery({
    queryKey: key("tracking-unit", id),
    queryFn: () => api.get<TrackingDetail>(`/tracking-units/${id}`),
    enabled: id !== null,
  });
}

export function useStageLogs(id: number | null) {
  return useQuery({
    queryKey: key("tracking-unit", id, "stage-logs"),
    queryFn: () =>
      api.get<
        Array<{
          id: number;
          from_stage_name: string;
          to_stage_name: string;
          direction: string;
          is_rollback: boolean;
          reason_label: string;
          note: string;
          moved_by_name: string;
          moved_at: string;
          /** 離開原階段時做到哪。完成度換站歸零，這是唯一查得回來的地方 */
          qty_at_exit: string | null;
          pct_at_exit: string | null;
        }>
      >(`/tracking-units/${id}/stage-logs`),
    enabled: id !== null,
  });
}

export function useMyWork() {
  return useQuery({
    queryKey: key("my-work"),
    queryFn: () => api.get<MyWorkData>("/tracking-units/my-work"),
    staleTime: 30 * 1000,
  });
}

/** 所有追蹤單元的變更操作共用這組失效規則 */
function invalidateTracking(qc: ReturnType<typeof useQueryClient>, id: number) {
  qc.invalidateQueries({ queryKey: key("tracking-unit", id) });
  qc.invalidateQueries({ queryKey: key("tracking-units") });
  qc.invalidateQueries({ queryKey: key("board") });
  qc.invalidateQueries({ queryKey: key("my-work") });
  qc.invalidateQueries({ queryKey: key("dashboard") });
}

export function useMoveStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: number;
      direction: "forward" | "backward";
      note?: string;
      reason_category?: string;
      expected_stage_id?: number;
    }) => api.post<MoveStageResult>(`/tracking-units/${id}/move-stage`, body),
    onSuccess: (_data, variables) => invalidateTracking(qc, variables.id),
  });
}

export function useSignoff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: number;
      signoff_by_name: string;
      signoff_date?: string;
      signoff_doc_no?: string;
      signoff_location?: number | null;
    }) => api.post<SignoffResult>(`/tracking-units/${id}/signoff`, body),
    onSuccess: (_data, variables) => {
      invalidateTracking(qc, variables.id);
      qc.invalidateQueries({ queryKey: key("billing") });
    },
  });
}

export function useReportProgress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: number;
      delta?: string;
      qty_done?: string;
      progress_pct?: string;
      note?: string;
    }) => api.post<ReportProgressResult>(`/tracking-units/${id}/report-progress`, body),
    onSuccess: (_data, variables) => invalidateTracking(qc, variables.id),
  });
}

// ── 請款 ───────────────────────────────────────────────────────────
export function useMilestones(params: Params = {}) {
  return useQuery({
    queryKey: key("billing", "milestones", params),
    queryFn: () => api.get<Paginated<Milestone>>("/billing-milestones", params),
  });
}

export function useBillingSummary() {
  return useQuery({
    queryKey: key("billing", "summary"),
    queryFn: () => api.get<BillingSummary>("/billing-milestones/summary"),
  });
}

export function useClaims(params: Params = {}) {
  return useQuery({
    queryKey: key("billing", "claims", params),
    queryFn: () => api.get<Paginated<Claim>>("/billing-claims", params),
  });
}

export function useTransitionClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: number;
      to_state: string;
      date?: string;
      invoice_no?: string;
      reason?: string;
    }) => api.post<Claim>(`/billing-claims/${id}/transition`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key("billing") });
      qc.invalidateQueries({ queryKey: key("dashboard") });
      qc.invalidateQueries({ queryKey: key("projects") });
    },
  });
}

// ── 資產 ───────────────────────────────────────────────────────────
export function useAssetSummary() {
  return useQuery({
    queryKey: key("assets", "summary"),
    queryFn: () => api.get<AssetSummary>("/assets/summary"),
  });
}

export function useAssets(params: Params = {}, enabled = true) {
  return useQuery({
    queryKey: key("assets", "units", params),
    queryFn: () => api.get<Paginated<AssetUnit>>("/assets", params),
    enabled,
  });
}

export function useLots(params: Params = {}, enabled = true) {
  return useQuery({
    queryKey: key("assets", "lots", params),
    queryFn: () => api.get<Paginated<Lot>>("/lots", params),
    enabled,
  });
}

export function useMoveAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: number;
      movement_type: string;
      to_location?: number | null;
      to_holder?: number | null;
      to_project?: number | null;
      note?: string;
    }) => api.post<{ asset: AssetUnit }>(`/assets/${id}/move`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: key("assets") }),
  });
}

// ── 產線 ───────────────────────────────────────────────────────────
export function useLines() {
  return useQuery({
    queryKey: key("lines"),
    queryFn: () => api.get<LinesData>("/production-lines"),
    staleTime: 60 * 1000,
  });
}

export function useUpdateLine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: number;
      status?: string;
      current_work?: string;
      utilization?: string;
      today_output?: string;
    }) => api.patch(`/production-lines/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: key("lines") }),
  });
}

// ── 通知 ───────────────────────────────────────────────────────────
export function useNotifications() {
  return useQuery({
    queryKey: key("notifications"),
    queryFn: () =>
      api.get<{ unread_count: number; results: Notification[] }>("/notifications"),
    staleTime: 60 * 1000,
  });
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id?: number) =>
      api.post(id ? `/notifications/${id}/read` : "/notifications/read"),
    onSuccess: () => qc.invalidateQueries({ queryKey: key("notifications") }),
  });
}
