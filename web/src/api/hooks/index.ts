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
  DashboardOverview,
  FlowCatalogStage,
  FlowTask,
  FlowTaskAssignment,
  FlowUnit,
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
  StaffWorkload,
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

// 主線不再手動推進——2026-08-15 起由流程進度自動判定（見 Projects 的 MainStageControl）

// ── 流程目錄與流程單元（2026-08 流程制）─────────────────────────────
/** 五大階段＋19 工作項的目錄。順序固定，只有 Admin 能改內容 */
export function useFlowCatalog(enabled = true) {
  return useQuery({
    queryKey: key("flow-catalog"),
    queryFn: () => api.get<FlowCatalogStage[]>("/flow-catalog"),
    enabled,
    staleTime: 30 * 60 * 1000,
  });
}

export function useFlowUnits(params: Params = {}, enabled = true) {
  return useQuery({
    queryKey: key("flow-units", params),
    queryFn: () => api.get<Paginated<FlowUnit>>("/flow-units", params),
    enabled,
  });
}

export function useFlowUnit(id: number | null) {
  return useQuery({
    queryKey: key("flow-unit", id),
    queryFn: () => api.get<FlowUnit>(`/flow-units/${id}`),
    enabled: id !== null,
    // 卡片開著的時候每 10 秒抓一次——員工回報分配進度，經理不用重整就看得到（D44）
    refetchInterval: 10_000,
  });
}

/** 流程單元動了，排程表、看板、我的任務、儀表板、金流全部跟著變 */
function invalidateFlows(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: key("flow-units") });
  qc.invalidateQueries({ queryKey: key("flow-unit") });
  qc.invalidateQueries({ queryKey: key("project") });
  qc.invalidateQueries({ queryKey: key("projects") });
  qc.invalidateQueries({ queryKey: key("dashboard") });
  // 完成可能觸發「自動可請款」（金流軌）
  qc.invalidateQueries({ queryKey: key("billing") });
  qc.invalidateQueries({ queryKey: key("cashflow") });
  qc.invalidateQueries({ queryKey: key("notifications") });
}

/** 排程表逐列改：負責人、詳細內容、預計起訖、數量 */
export function useSaveFlowUnit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number } & Record<string, unknown>) =>
      api.patch<FlowUnit>(`/flow-units/${id}`, body),
    onSuccess: () => invalidateFlows(qc),
  });
}

/** 開始／完成／重啟／標不適用 */
export function useFlowTransition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number; to_state: string; note?: string }) =>
      api.post<FlowUnit>(`/flow-units/${id}/transition`, body),
    onSuccess: () => invalidateFlows(qc),
  });
}

export function useFlowReport() {
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
    }) => api.post<FlowUnit>(`/flow-units/${id}/report-progress`, body),
    onSuccess: () => invalidateFlows(qc),
  });
}

/** 調整專案勾了哪些流程（建案後編輯） */
export function useSetFlows(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (flowItemIds: number[]) =>
      api.post<{
        project: ProjectDetail;
        added: string[];
        removed: string[];
        marked_na: string[];
        restored: string[];
      }>(`/projects/${projectId}/set-flows`, { flow_items: flowItemIds }),
    onSuccess: () => invalidateFlows(qc),
  });
}

// ── 工作項目（流程單元的內容物清單）─────────────────────────────────
export function useAddFlowTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { unit: number; name: string; qty?: string | null; unit_of_measure?: string; status?: string }) =>
      api.post<FlowTask>("/flow-tasks", body),
    onSuccess: () => invalidateFlows(qc),
  });
}

export function useSaveFlowTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number; name?: string; qty?: string | null; unit_of_measure?: string; status?: string; statuses?: string[] }) =>
      api.patch<FlowTask>(`/flow-tasks/${id}`, body),
    onSuccess: () => invalidateFlows(qc),
  });
}

export function useDeleteFlowTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/flow-tasks/${id}`),
    onSuccess: () => invalidateFlows(qc),
  });
}

// ── 工作分配（D41：工作項目 × 工段 × 員工）──────────────────────────
export function useTaskAssignments(params: Params = {}, enabled = true) {
  return useQuery({
    queryKey: key("flow-units", "assignments", params),
    queryFn: () => api.get<Paginated<FlowTaskAssignment>>("/task-assignments", params),
    enabled,
  });
}

export function useAddTaskAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { task: number; status: string; assignee: number; qty_assigned: string }) =>
      api.post<FlowTaskAssignment>("/task-assignments", body),
    onSuccess: () => invalidateFlows(qc),
  });
}

/** 員工回報自己的分配（只送 qty_done）；經理也能改派 */
export function useSaveTaskAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number } & Record<string, unknown>) =>
      api.patch<FlowTaskAssignment>(`/task-assignments/${id}`, body),
    onSuccess: () => invalidateFlows(qc),
  });
}

export function useDeleteTaskAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/task-assignments/${id}`),
    onSuccess: () => invalidateFlows(qc),
  });
}

/** 員工視圖（D46）：每個員工手上有什麼、該月完成什麼。掛在 flow-units 鍵下，操作後自動刷新 */
export function useStaffWorkload(month: string) {
  return useQuery({
    queryKey: key("flow-units", "staff-workload", month),
    queryFn: () => api.get<StaffWorkload>("/staff-workload", { month }),
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
export function useMilestones(params: Params = {}, enabled = true) {
  return useQuery({
    queryKey: key("billing", "milestones", params),
    queryFn: () => api.get<Paginated<Milestone>>("/billing-milestones", params),
    enabled,
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
