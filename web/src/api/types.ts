/**
 * 領域型別
 *
 * `schema.d.ts` 由 OpenAPI 自動產生，涵蓋各 ModelSerializer；
 * 但具名 action（move-stage、signoff、board、summary…）回傳的是組合過的形狀，
 * drf-spectacular 推不精確，在這裡手寫。
 *
 * 判斷標準：**能自動產生的就不要手寫**。這裡只放自動產生不了的。
 */

export type StatusCode = "ontrack" | "atrisk" | "delayed";
export type UnitType = "batch" | "work_item";
export type MilestoneState = "pending" | "claimable" | "invoiced" | "received";

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface Option {
  value: string;
  label: string;
}

export interface Stage {
  id: number;
  seq: number;
  code: string;
  name: string;
  color: string;
  stall_days: number | null;
}

export interface StageTemplate {
  id: number;
  code: string;
  name: string;
  applies_to: string;
  is_default: boolean;
  stages: Stage[];
}

// ── 專案 ────────────────────────────────────────────────────────────
export interface ProjectRow {
  id: number;
  code: string;
  name: string;
  project_type: string;
  project_type_label: string;
  customer_name: string;
  owner_name: string;
  /** 沒有看金額權限時為 null——不是 0，是「不給看」 */
  contract_amount: string | null;
  effective_amount: string | null;
  received_amount: string | null;
  collection_rate: number | null;
  start_date: string | null;
  due_date: string | null;
  actual_end_date: string | null;
  is_overdue: boolean;
  days_left: number | null;
  main_stage_name: string;
  main_stage_seq: number;
  main_stage_total: number;
  status: StatusCode;
  is_closed: boolean;
  unit_count: number;
  attention_count: number;
}

export interface ProjectDetail extends ProjectRow {
  customer: { id: number; name: string; contact_name: string; contact_phone: string } | null;
  owner: { id: number; name: string; title: string } | null;
  main_stage: Stage;
  main_stages: Stage[];
  /** 應收款直接掛在專案明細上。檢視角色拿到空陣列 */
  milestones: Milestone[];
  approved_change_amount: string | null;
  note: string;
  contract_terms: string;
  quote_info: string;
  doc_links: string;
  can_advance: boolean;
  can_rollback: boolean;
  can_edit: boolean;
  can_view_amounts: boolean;
}

export interface ChangeOrder {
  id: number;
  code: string;
  project: number;
  title: string;
  /** 沒有看金額權限時為 null。追加為正、減帳為負 */
  amount: string | null;
  reason: string;
  status: "draft" | "submitted" | "approved" | "rejected";
  status_label: string;
  is_approved: boolean;
  approved_by_name: string;
  approved_at: string | null;
  created_at: string;
}

export interface ProjectSummary {
  unit_counts: { total: number; ontrack: number; atrisk: number; delayed: number };
  by_stage: Array<{ name: string; seq: number; count: number }>;
  avg_completion: number;
  billing: {
    contract_amount: string;
    claimable: string;
    invoiced: string;
    received: string;
    collection_rate: number;
    milestone_count: number;
  } | null;
}

// ── 追蹤單元 ────────────────────────────────────────────────────────
export interface TrackingCard {
  id: number;
  code: string;
  name: string;
  unit_type: UnitType;
  status: StatusCode;
  project: number;
  project_name: string;
  project_code: string;
  stage_id: number;
  stage_name: string;
  stage_seq: number;
  stage_total: number;
  qty_total: string | null;
  qty_done: string;
  unit_of_measure: string;
  progress_pct: string | null;
  completion_ratio: number;
  days_in_stage: number;
  is_stalled: boolean;
  plan_end: string | null;
  can_advance: boolean;
  can_rollback: boolean;
  can_report: boolean;
}

export interface TrackingDetail extends TrackingCard {
  current_stage: Stage;
  stages: Stage[];
  note: string;
  subcontractor: number | null;
  subcontractor_name: string;
  plan_start: string | null;
  actual_start: string | null;
  actual_end: string | null;
  quick_increments: number[];
}

export interface BoardColumn {
  stage: Stage;
  count: number;
  units: TrackingCard[];
}

/** 一條流程一個看板。混合案有兩條流程，就有兩個看板上下堆疊 */
export interface Board {
  template: StageTemplate;
  count: number;
  columns: BoardColumn[];
}

export interface BoardData {
  boards: Board[];
  total: number;
  shown: number;
  truncated: boolean;
  truncated_hint: string | null;
}

export interface MoveStageResult {
  unit: TrackingDetail;
}

export interface ReportProgressResult {
  unit: TrackingDetail;
  log: { id: number; delta: string; reported_at: string };
  suggestion: { type: string; message: string; next_stage_id: number } | null;
}
export interface Milestone {
  id: number;
  project: number;
  project_name: string;
  project_code: string;
  seq: number;
  label: string;
  /** 合約原文——提醒自己「什麼條件到了可以請」 */
  condition: string;
  percentage: string;
  amount: string;
  state: MilestoneState;
  state_label: string;
  /** 這筆現在可以轉去哪些狀態，由後端算好 */
  next_states: Option[];
  /** 預計請款日。由人填；沒填的列不會出現在現金流預測裡 */
  expected_date: string | null;
  claimable_at: string | null;
  invoice_date: string | null;
  invoice_no: string;
  due_date: string | null;
  receive_date: string | null;
  outstanding_amount: string;
  /** 可請款後放了幾天。超過 7 天就是漏掉的錢 */
  days_since_claimable: number | null;
  note: string;
  can_edit: boolean;
}

export interface BillingSummary {
  pending: string;
  claimable: string;
  invoiced: string;
  received: string;
  claimable_count: number;
  overdue_claimable: { count: number; amount: string };
}

// ── 儀表板 ──────────────────────────────────────────────────────────
export interface KpiCardData {
  key: string;
  label: string;
  value: number;
  unit: string;
  status: "good" | "warn" | "bad" | "neutral";
  detail?: string;
}

export interface DashboardOverview {
  cards: KpiCardData[];
  by_stage: Array<{
    template: string;
    applies_to: string;
    total: number;
    stages: Array<{ name: string; seq: number; color: string; count: number }>;
  }>;
  projects: Array<
    Pick<ProjectRow, "id" | "code" | "name" | "status" | "due_date" | "is_overdue"> & {
      customer: string;
      stage_name: string;
      stage_seq: number;
      stage_total: number;
      unit_count: number;
      attention: number;
      contract_amount?: string;
      received_amount?: string;
      collection_rate?: number;
    }
  >;
  can_view_amounts: boolean;
}

export interface AttentionItem {
  type: string;
  severity: "bad" | "warn" | "info";
  title: string;
  reason: string;
  action: string;
  link: string;
  unit_id?: number;
}

export interface AttentionData {
  count: number;
  by_severity: { bad: number; warn: number; info: number };
  results: AttentionItem[];
}

export interface Activity {
  id: number;
  verb: string;
  category: string;
  actor: string;
  project: string;
  created_at: string;
}
// ── 選項 ────────────────────────────────────────────────────────────
export interface OptionsData {
  status: Option[];
  project_type: Option[];
  unit_type: Option[];
  milestone_state: Option[];
  change_order_status: Option[];
  attachment_category: Option[];
  subcontract_category: Option[];
  subcontract_status: Option[];
  payment_term_type: Option[];
  payment_method: Option[];
  payable_state: Option[];
  certainty: Option[];
  role: Option[];
  status_colors: Record<string, string>;
  users: Array<{ id: number; name: string; employee_no: string | null }>;
  projects: Array<{ id: number; code: string; name: string; project_type: string }>;
}

export interface Notification {
  id: number;
  title: string;
  body: string;
  link_url: string;
  category: string;
  category_label: string;
  is_read: boolean;
  created_at: string;
}

// ── 附件 ────────────────────────────────────────────────────────────
/** 附件掛在哪。用名字而不是 ContentType id——那是資料庫內部編號 */
export type AttachmentTarget = "project" | "tracking-unit" | "milestone";

export interface Attachment {
  id: number;
  original_name: string;
  size_bytes: number;
  size_display: string;
  mime_type: string;
  ext: string;
  category: string;
  category_label: string;
  /** 只有 PDF 與圖片為 true。依**實際** MIME 判定，不是副檔名 */
  is_previewable: boolean;
  /** 不能預覽時，直接說為什麼。不做假的預覽按鈕 */
  no_preview_reason: string;
  checksum: string;
  note: string;
  uploaded_by_name: string;
  uploaded_at: string;
  /** 上傳者本人或經營者。合約與簽收單是爭議時的依據 */
  can_delete: boolean;
}

export interface AttachmentList {
  results: Attachment[];
  can_upload: boolean;
  categories: Option[];
  max_size_mb: number;
  allowed_extensions: string[];
}

// ── 應付 ────────────────────────────────────────────────────────────
export type PayableState = "pending" | "approved" | "paid";
export type Certainty = "confirmed" | "likely" | "estimated";

export interface Subcontract {
  id: number;
  code: string;
  project: number;
  project_name: string;
  project_code: string;
  vendor: number;
  vendor_name: string;
  title: string;
  category: string;
  category_label: string;
  contract_amount: string;
  payment_term_type: string;
  payment_term_days: number;
  /** 「月結 60 天（計價當月月底起算）」——不寫清楚沒人知道怎麼算 */
  payment_terms_display: string;
  retention_pct: string;
  start_date: string | null;
  end_date: string | null;
  status: string;
  status_label: string;
  note: string;
  billed_amount: string;
  paid_amount: string;
  remaining_amount: string;
  billed_pct: number | null;
  payable_count: number;
  created_at: string;
}

export interface Payable {
  id: number;
  subcontract: number | null;
  subcontract_code: string;
  subcontract_title: string;
  project: number;
  project_name: string;
  vendor: number;
  vendor_name: string;
  category: string;
  category_label: string;
  title: string;
  amount: string;
  tax_amount: string;
  retention_amount: string;
  /** 未稅 ＋ 稅額 − 保留款。實際會匯出去的數字 */
  payable_amount: string;
  state: PayableState;
  state_label: string;
  next_states: Option[];
  billing_date: string | null;
  due_date: string | null;
  paid_date: string | null;
  /** 錢實際離開帳戶的那天。支票看兌現日，其餘看付款日 */
  cash_date: string | null;
  cash_date_note: string;
  payment_method: string;
  method_label: string;
  check_due_date: string | null;
  check_no: string;
  invoice_no: string;
  note: string;
  is_overdue: boolean;
  created_at: string;
}

export interface PayableSummary {
  pending: string;
  approved: string;
  paid: string;
  overdue: { count: number; amount: string };
}

export interface CashflowDetail {
  direction: "in" | "out";
  date: string;
  amount: string;
  certainty: Certainty;
  party: string;
  project: string;
  title: string;
  note: string;
  kind: string;
  id: number;
}

export interface CashflowCell {
  key: string;
  label: string;
  start: string;
  end: string;
  income: string;
  expense: string;
  net: string;
  cumulative: string;
  income_by_certainty: Partial<Record<Certainty, string>>;
  expense_by_certainty: Partial<Record<Certainty, string>>;
  detail_count: number;
  details: CashflowDetail[];
}

export interface CashflowForecast {
  granularity: "week" | "month";
  periods: number;
  generated_at: string;
  cells: CashflowCell[];
  /** ★ 整個畫面的重點：累計跌破零的第一格。沒有就是 null */
  shortfall: { key: string; label: string; amount: string } | null;
  totals: { income: string; expense: string; net: string };
  /** 落在時間窗外的錢。不顯示的話會以為總額就是全部 */
  outside_window: { income: string; expense: string };
  certainty_levels: Option[];
  disclaimer: string;
  tax_note: string;
  project_count: number;
}

export interface ProjectPnl {
  project_id: number;
  project_name: string;
  revenue: string;
  received: string;
  billed: { cost: string; gross: string; pct: number | null };
  committed: { cost: string; gross: string; pct: number | null };
  paid_amount: string;
  note: string;
}
