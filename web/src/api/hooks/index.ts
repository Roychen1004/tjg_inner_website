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
  Attachment,
  AttachmentList,
  AttachmentTarget,
  AttentionData,
  Activity,
  CashflowForecast,
  BillingSummary,
  BoardData,
  DashboardOverview,
  Milestone,
  MoveStageResult,
  Notification,
  OptionsData,
  Paginated,
  Payable,
  PayableSummary,
  ProjectDetail,
  ProjectPnl,
  ProjectRow,
  ProjectSummary,
  ReportProgressResult,
  Subcontract,
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

/** 所有追蹤單元的變更操作共用這組失效規則 */
function invalidateTracking(qc: ReturnType<typeof useQueryClient>, id: number) {
  qc.invalidateQueries({ queryKey: key("tracking-unit", id) });
  qc.invalidateQueries({ queryKey: key("tracking-units") });
  qc.invalidateQueries({ queryKey: key("board") });
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
      expected_stage_id?: number;
    }) => api.post<MoveStageResult>(`/tracking-units/${id}/move-stage`, body),
    onSuccess: (_data, variables) => invalidateTracking(qc, variables.id),
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

// ── 應收款 ─────────────────────────────────────────────────────────
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

/** 應收款動了，錢相關的畫面全部要跟著變 */
function invalidateBilling(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: key("billing") });
  qc.invalidateQueries({ queryKey: key("dashboard") });
  qc.invalidateQueries({ queryKey: key("projects") });
  qc.invalidateQueries({ queryKey: key("project") });
  qc.invalidateQueries({ queryKey: key("cashflow") });
  qc.invalidateQueries({ queryKey: key("pnl") });
}

export function useSaveMilestone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id?: number } & Record<string, unknown>) =>
      id
        ? api.patch<Milestone>(`/billing-milestones/${id}`, body)
        : api.post<Milestone>("/billing-milestones", body),
    onSuccess: () => invalidateBilling(qc),
  });
}

export function useDeleteMilestone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/billing-milestones/${id}`),
    onSuccess: () => invalidateBilling(qc),
  });
}

export function useTransitionMilestone() {
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
    }) => api.post<Milestone>(`/billing-milestones/${id}/transition`, body),
    onSuccess: () => invalidateBilling(qc),
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

// ── 附件 ───────────────────────────────────────────────────────────
/** 一個掛載對象一份快取。換專案就是換一份清單 */
const attachmentKey = (target: AttachmentTarget, id: number) => key("attachments", target, id);

export function useAttachments(target: AttachmentTarget, id: number | null) {
  return useQuery({
    queryKey: attachmentKey(target, id ?? 0),
    queryFn: () => api.get<AttachmentList>("/attachments", { target, id: id! }),
    enabled: id !== null,
  });
}

export function useUploadAttachment(target: AttachmentTarget, id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, category, note }: { file: File; category: string; note?: string }) => {
      const form = new FormData();
      form.append("file", file);
      form.append("target", target);
      form.append("id", String(id));
      form.append("category", category);
      if (note) form.append("note", note);
      return api.upload<Attachment>("/attachments", form);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: attachmentKey(target, id) }),
  });
}

export function useDeleteAttachment(target: AttachmentTarget, id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (attachmentId: number) => api.delete(`/attachments/${attachmentId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: attachmentKey(target, id) }),
  });
}

/** 下載與預覽都直接給網址——檔案由 nginx 送，不經過 fetch 與記憶體 */
export function attachmentUrl(id: number, inline = false) {
  return `/api/v0.1/attachments/${id}/download${inline ? "?inline=1" : ""}`;
}

// ── 分包合約 ───────────────────────────────────────────────────────
export function useSubcontracts(params: Params = {}, enabled = true) {
  return useQuery({
    queryKey: key("subcontracts", params),
    queryFn: () => api.get<Paginated<Subcontract>>("/subcontracts", params),
    enabled,
  });
}

/** 分包合約與應付款項互相影響（合約的已計價來自應付），一起失效 */
function invalidatePayables(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: key("subcontracts") });
  qc.invalidateQueries({ queryKey: key("payables") });
  qc.invalidateQueries({ queryKey: key("cashflow") });
  qc.invalidateQueries({ queryKey: key("pnl") });
}

export function useSaveSubcontract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id?: number } & Record<string, unknown>) =>
      id
        ? api.patch<Subcontract>(`/subcontracts/${id}`, body)
        : api.post<Subcontract>("/subcontracts", body),
    onSuccess: () => invalidatePayables(qc),
  });
}

export function useDeleteSubcontract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/subcontracts/${id}`),
    onSuccess: () => invalidatePayables(qc),
  });
}

// ── 應付款項 ───────────────────────────────────────────────────────
export function usePayables(params: Params = {}, enabled = true) {
  return useQuery({
    queryKey: key("payables", params),
    queryFn: () => api.get<Paginated<Payable>>("/payables", params),
    enabled,
  });
}

export function usePayableSummary() {
  return useQuery({
    queryKey: key("payables", "summary"),
    queryFn: () => api.get<PayableSummary>("/payables/summary"),
  });
}

export function useSavePayable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id?: number } & Record<string, unknown>) =>
      id ? api.patch<Payable>(`/payables/${id}`, body) : api.post<Payable>("/payables", body),
    onSuccess: () => invalidatePayables(qc),
  });
}

export function useTransitionPayable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: number;
      to_state: string;
      date?: string;
      payment_method?: string;
      check_due_date?: string;
      check_no?: string;
      reason?: string;
    }) => api.post<Payable>(`/payables/${id}/transition`, body),
    onSuccess: () => invalidatePayables(qc),
  });
}

export function useDeletePayable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/payables/${id}`),
    onSuccess: () => invalidatePayables(qc),
  });
}

// ── 現金流與損益 ───────────────────────────────────────────────────
export function useCashflow(params: Params = {}, enabled = true) {
  return useQuery({
    queryKey: key("cashflow", params),
    queryFn: () => api.get<CashflowForecast>("/cashflow/forecast", params),
    enabled,
    // 現金流是彙總，算得比較久；一分鐘內不重打
    staleTime: 60 * 1000,
  });
}

export function useProjectPnl(id: number | null) {
  return useQuery({
    queryKey: key("pnl", id),
    queryFn: () => api.get<ProjectPnl>(`/projects/${id}/pnl`),
    enabled: id !== null,
  });
}
