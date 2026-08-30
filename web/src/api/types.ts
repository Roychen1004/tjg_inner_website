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
export type FlowStateCode = "todo" | "doing" | "done" | "na";
export type ProjectLifecycle = "active" | "lost" | "paused" | "closed";

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

// ── 流程目錄與流程單元（2026-08 流程制）─────────────────────────────
export interface FlowCatalogItem {
  id: number;
  /** 所屬模板（D49）。資料遷移前的舊列可能是 null＝預設模板 */
  template: number | null;
  stage: number;
  seq: number;
  code: string;
  name: string;
  description: string;
  deliverables: string;
  done_criteria: string;
  is_gate: boolean;
  /** 有值＝這一項的進度由構件批次自動彙總 */
  batch_stage_seq: number | null;
  /** 有案子用過——刪不掉，只能停用 */
  in_use: boolean;
}

/** 流程模板（D49）：一份「這種案子要走哪些流程」的目錄 */
export interface FlowTemplate {
  id: number;
  name: string;
  is_default: boolean;
  is_active: boolean;
  item_count: number;
}

export interface FlowCatalogStage {
  id: number;
  seq: number;
  code: string;
  name: string;
  /** 這一大階段的收斂點（例：「合約簽訂」） */
  gate: string;
  items: FlowCatalogItem[];
}

export interface FlowUnit {
  id: number;
  project: number;
  project_name: string;
  project_code: string;
  /** null＝自訂流程（D49，目錄上沒有的一步） */
  flow_item: number | null;
  seq: number;
  flow_code: string;
  flow_name: string;
  stage_seq: number;
  stage_name: string;
  is_custom: boolean;
  description: string;
  deliverables: string;
  done_criteria: string;
  is_gate: boolean;
  state: FlowStateCode;
  state_label: string;
  assignee: number | null;
  assignee_name: string;
  detail: string;
  plan_start: string | null;
  plan_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  qty_total: string | null;
  qty_done: string;
  unit_of_measure: string;
  progress_pct: string | null;
  completion_ratio: number;
  is_overdue: boolean;
  /** true＝進度由構件批次自動彙總，不能手動回報 */
  is_batch_driven: boolean;
  subcontractor: number | null;
  subcontractor_name: string;
  note: string;
  /** 負責人本人或有進度維護權限的人 */
  can_operate: boolean;
  /** 工作項目：這一步的內容物清單（如「鐵材 500 噸：已下訂單」） */
  tasks: FlowTask[];
}

/** 工作分配（D41）：工作項目的一個工段分量派給一個員工 */
export interface FlowTaskAssignment {
  id: number;
  task: number;
  /** 工段名，如「切割中」——來自單元的 task_statuses */
  status: string;
  assignee: number | null;
  assignee_name: string;
  qty_assigned: string;
  qty_done: string;
  is_done: boolean;
  /** 經理分配時的叮嚀（D49）——被分到的人要特別看到這段話 */
  note: string;
  /** 工作類型（D52）——產能統計的分類，新分配必選 */
  work_type: number | null;
  work_type_name: string;
  /** 員工按「開始」的那天（D52）；回報過就自動視為已開始 */
  started_at: string | null;
  /** 完成量報滿的那天（D52） */
  completed_at: string | null;
  /** 工數補登修正（D52）——空＝系統依回報自動計 */
  man_days_override: string | null;
  // 「我的任務」清單用的補充資訊
  unit: number;
  task_name: string;
  task_qty: string | null;
  unit_of_measure: string;
  flow_name: string;
  project_name: string;
}

/** 流程單元的工作項目。狀態清單是**每個項目自己的**（D45） */
export interface FlowTask {
  id: number;
  unit: number;
  name: string;
  qty: string | null;
  unit_of_measure: string;
  status: string;
  /** 這個項目的工段清單（使用者自己加；未開始／已完成是隱含頭尾） */
  statuses: string[];
  assignments: FlowTaskAssignment[];
  /** 總進度＝各工段完成度的平均 */
  progress_pct: number;
}

/** 員工視圖（D46）：一列＝一個員工手上／該月完成的東西 */
export interface WorkloadUnit {
  id: number;
  project_name: string;
  flow_name: string;
  state: FlowStateCode;
  plan_end: string | null;
  actual_end: string | null;
}

export interface WorkloadAssignment {
  id: number;
  unit: number;
  project_name: string;
  flow_name: string;
  task_name: string;
  status: string;
  qty_done: number;
  qty_assigned: number;
  unit_of_measure: string;
  /** 最後回報日（做完的分配＝完成日） */
  reported_at: string;
  // D52：老闆要看「誰開始了、誰還沒」
  work_type_name: string;
  started_at: string | null;
  completed_at: string | null;
  /** 系統計工（一人一天 1 工，記在有回報的那件；含補登修正） */
  man_days: number;
  reported_today: boolean;
}

export interface StaffWorkload {
  month: string;
  staff: Array<{
    id: number;
    name: string;
    title: string;
    open_units: WorkloadUnit[];
    open_assignments: WorkloadAssignment[];
    done_units: WorkloadUnit[];
    done_assignments: WorkloadAssignment[];
  }>;
}

/** 卡片迷你甘特：一大階段縮成一條 bar */
export interface GanttBar {
  seq: number;
  name: string;
  start: string | null;
  end: string | null;
  total: number;
  done: number;
  doing: number;
  overdue: boolean;
}

// ── 專案 ────────────────────────────────────────────────────────────
export interface ProjectRow {
  id: number;
  code: string;
  name: string;
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
  status: StatusCode;
  lifecycle: ProjectLifecycle;
  lifecycle_label: string;
  is_closed: boolean;
  unit_count: number;
  attention_count: number;
  flow_gantt: GanttBar[];
}

export interface ProjectDetail extends ProjectRow {
  customer: { id: number; name: string; contact_name: string; contact_phone: string } | null;
  owner: { id: number; name: string; title: string } | null;
  /** 應收款直接掛在專案明細上。檢視角色拿到空陣列 */
  milestones: Milestone[];
  /** 建案時勾的流程，依目錄順序 */
  flow_units: FlowUnit[];
  approved_change_amount: string | null;
  /** 未簽約前的估價金額（金流預測用）。沒有看金額權限時為 null */
  estimate_amount: string | null;
  note: string;
  contract_terms: string;
  quote_info: string;
  doc_links: string;
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
  /** 觸發流程：該流程單元完成 → 這一期自動轉「可請款」 */
  trigger_unit: number | null;
  trigger_unit_name: string;
  trigger_unit_state: FlowStateCode | "";
  /** 負責收款的會計師（D45）：觸發時通知他、出現在他的「我的任務」 */
  accountant: number | null;
  accountant_name: string;
  /** 預計請款日。由人填；沒填的列不會出現在現金流預測裡 */
  expected_date: string | null;
  /** 預測請款日＝expected_date，沒填就取觸發流程的預計完成日 */
  forecast_date: string | null;
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
      flow_gantt: GanttBar[];
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
  project_lifecycle: Option[];
  flow_state: Option[];
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
  /** 會計師角色的啟用帳號——期別「負責收款」下拉用（D45） */
  accountants: Array<{ id: number; name: string }>;
  /** 工作項目狀態的建議字——沿用大家之前新增過的（頻率高的在前） */
  task_status_suggestions: string[];
  projects: Array<{ id: number; code: string; name: string }>;
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
export type AttachmentTarget = "project" | "tracking-unit" | "flow-unit" | "milestone";

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
  /** 這筆錢花在哪個流程上（可不掛） */
  flow_unit: number | null;
  flow_unit_name: string;
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
  /** 明細（D52）——選填；有明細時金額＝明細合計 */
  lines: PayableLine[];
}

/** 應付明細一列（D52）：品項 × 數量 × 單價 */
export interface PayableLine {
  id: number;
  item: number;
  item_name: string;
  unit_of_measure: string;
  qty: string;
  unit_price: string;
  amount: string;
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
  /** 公司現有現金（D49）。null＝這個人看不到（或看單一專案）；有值＝累計已含它 */
  opening_balance: string | null;
}

/** 公司現有現金（D49）：只有經理與系統管理員看得到 */
export interface CashBalance {
  amount: string;
  note: string;
  updated_at: string;
  updated_by_name: string;
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

// ── 產能與成本（D52）────────────────────────────────────────────────
/** 工作類型標籤——分配工作時必選，產能統計的分類基準 */
export interface WorkType {
  id: number;
  name: string;
  is_active: boolean;
}

/** 品項主檔——應付明細指到這裡，單價按品項累積 */
export interface MaterialItem {
  id: number;
  name: string;
  unit_of_measure: string;
  is_active: boolean;
}

export interface ProductivityRow {
  work_type: string;
  unit_of_measure: string;
  qty: number;
  man_days: number;
  /** 每工產出＝量 ÷ 工；工為 0 時為 null */
  per_man_day: number | null;
}

export interface ProductivityStats {
  start: string;
  end: string;
  people: Array<{
    id: number;
    name: string;
    title: string;
    man_days: number;
    rows: ProductivityRow[];
  }>;
  company: Array<
    ProductivityRow & {
      monthly: Array<{ month: string; qty: number; man_days: number }>;
    }
  >;
}

export interface UnitPricePoint {
  date: string;
  qty: number;
  unit_price: number;
  amount: number;
  vendor: string;
  payable: number;
  title: string;
}

export interface UnitPriceStats {
  items: Array<{
    id: number;
    name: string;
    unit_of_measure: string;
    count: number;
    total_qty: number;
    avg_price: number | null;
    latest_price: number;
    points: UnitPricePoint[];
  }>;
}

export interface FlowCostStats {
  rows: Array<{
    flow_name: string;
    unit_count: number;
    total: number;
    avg: number;
  }>;
}
