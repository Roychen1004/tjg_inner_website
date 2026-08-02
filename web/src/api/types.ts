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
export type ClaimState = "claimable" | "invoiced" | "received";
export type MilestoneState = "pending" | "claimable" | "partial" | "invoiced" | "received";

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
  is_billing_trigger: boolean;
  requires_signoff: boolean;
  is_outsource: boolean;
  is_hold: boolean;
  is_core: boolean;
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
  phases: Array<{
    id: number;
    project: number;
    seq: number;
    name: string;
    note: string;
    unit_count: number;
  }>;
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

export interface ProjectSummary {
  unit_counts: { total: number; ontrack: number; atrisk: number; delayed: number };
  by_stage: Array<{ name: string; seq: number; count: number }>;
  awaiting_signoff: Array<{ id: number; code: string; name: string; days_in_stage: number }>;
  avg_completion: number;
  billing: {
    contract_amount: string;
    claimable: string;
    claimed: string;
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
  /** 期別 id。編輯時要帶回去，否則存檔會把期別清掉 */
  phase: number | null;
  phase_name: string;
  assignee_name: string;
  stage_id: number;
  stage_name: string;
  stage_seq: number;
  stage_total: number;
  requires_signoff: boolean;
  is_billing_trigger: boolean;
  qty_total: string | null;
  qty_done: string;
  unit_of_measure: string;
  progress_pct: string | null;
  completion_ratio: number;
  total_weight_kg: string | null;
  days_in_stage: number;
  is_stalled: boolean;
  is_signed_off: boolean;
  is_awaiting_signoff: boolean;
  is_outsource_overdue: boolean;
  plan_end: string | null;
  rollback_count: number;
  can_advance: boolean;
  can_rollback: boolean;
  can_signoff: boolean;
  can_report: boolean;
}

export interface TrackingDetail extends TrackingCard {
  current_stage: Stage;
  stages: Stage[];
  assignee: { id: number; name: string } | null;
  note: string;
  work_mode: string;
  subcontractor_name: string;
  outsource_vendor_name: string;
  outsource_in_date: string | null;
  outsource_due_date: string | null;
  outsource_out_date: string | null;
  transport_vendor_name: string;
  signoff_date: string | null;
  signoff_by_name: string;
  signoff_doc_no: string;
  signoff_location_name: string;
  plan_start: string | null;
  actual_start: string | null;
  actual_end: string | null;
  quick_increments: number[];
  can_edit_weight: boolean;
  rollback_reasons: Option[];
}

export interface BoardColumn {
  /** null 代表這一欄的單元走的是另一條模板（混合案）。誠實顯示，不默默丟掉 */
  stage: Stage | null;
  count: number;
  units: TrackingCard[];
}

export interface BoardData {
  template: StageTemplate | null;
  columns: BoardColumn[];
  total: number;
  shown: number;
  truncated: boolean;
  truncated_hint: string | null;
}

/** 推進階段的回應。副作用要講清楚，不能按完就沒下文 */
export interface MoveStageResult {
  unit: TrackingDetail;
  warnings: string[];
  next_action: { type: string; message: string; next_stage_id?: number } | null;
  status_changed: { from: StatusCode; to: StatusCode; reason: string } | null;
}

export interface SignoffResult {
  unit: TrackingDetail;
  billing: {
    triggered: boolean;
    reason: string;
    progress_text: string;
    claim?: { id: number; amount: string; milestone: string };
  };
  warnings: string[];
}

export interface ReportProgressResult {
  unit: TrackingDetail;
  log: { id: number; delta: string; reported_at: string };
  suggestion: { type: string; message: string; next_stage_id: number } | null;
}

export interface MyWorkData {
  count: number;
  results: TrackingCard[];
  summary: { delayed: number; atrisk: number; awaiting_signoff: number };
}

// ── 請款 ────────────────────────────────────────────────────────────
export interface Claim {
  id: number;
  milestone: number;
  milestone_label: string;
  project_id: number;
  project_name: string;
  seq: number;
  amount: string;
  source: string;
  source_label: string;
  is_auto: boolean;
  triggered_by_name: string;
  weight_kg_snapshot: string | null;
  state: ClaimState;
  state_label: string;
  next_states: Option[];
  claimable_at: string;
  invoice_date: string | null;
  invoice_no: string;
  receive_date: string | null;
  days_since_claimable: number | null;
  note: string;
}

export interface Milestone {
  id: number;
  project: number;
  project_name: string;
  project_code: string;
  phase: number | null;
  phase_name: string;
  seq: number;
  label: string;
  trigger_desc: string;
  percentage: string;
  amount: string;
  trigger_type: string;
  trigger_label: string;
  threshold_pct: string | null;
  target_location_name: string;
  weight_basis_kg: string | null;
  is_weight_basis_locked: boolean;
  claimable_amount: string;
  claimed_amount: string;
  received_amount: string;
  /** 還沒收到的錢＝金額 − 已收款 */
  outstanding_amount: string;
  /** 還能再建立多少請款＝金額 − 累計可請。部分請款後與 outstanding 不同 */
  remaining_claimable: string;
  state: MilestoneState;
  state_label: string;
  note: string;
  progress: {
    text: string;
    pct: number | null;
    threshold_pct?: number | null;
    signed_units?: number;
    total_units?: number;
    /** 還沒簽收的批次，各自卡在哪一站。「還差 3 批」要說得出是哪 3 批 */
    pending?: Array<{
      id: number;
      name: string;
      stage_name: string;
      ready_to_sign: boolean;
      hint: string;
    }>;
  };
  claims: Claim[];
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

// ── 資產 ────────────────────────────────────────────────────────────
export interface AssetUnit {
  id: number;
  asset_no: string;
  item: number;
  item_code: string;
  item_name: string;
  item_kind: string;
  serial_no: string;
  brand: string;
  model: string;
  location: number;
  location_name: string;
  location_path: string;
  holder: number | null;
  holder_name: string;
  current_project: number | null;
  current_project_name: string;
  current_project_code: string;
  asset_status: string;
  status_label: string;
  purchase_date: string | null;
  next_maintenance_date: string | null;
  calibration_due_date: string | null;
  is_calibration_overdue: boolean;
  is_maintenance_overdue: boolean;
  note: string;
}

export interface Lot {
  id: number;
  lot_no: string;
  item_code: string;
  item_name: string;
  item_kind: string;
  spec_label: string;
  material_grade: string;
  surface_treatment: string;
  dimensions: Record<string, string>;
  unit_of_measure: string;
  location_name: string;
  location_path: string;
  location_type: string;
  qty_on_hand: string;
  qty_reserved: string;
  qty_available: string;
  total_weight_kg: string | null;
  status: string;
  status_label: string;
  aging_status: string;
  aging_label: string;
  aging_days: number | null;
  reserved_for_project_name: string;
  received_date: string | null;
  mill_cert_no: string;
  heat_no: string;
  is_remnant: boolean;
  parent_lot_no: string;
  actual_length_mm: string | null;
  actual_width_mm: string | null;
  note: string;
}

export interface AssetSummary {
  by_kind: Record<
    string,
    {
      label: string;
      mode: "individual" | "quantity";
      count: number;
      in_use?: number;
      idle?: number;
      unavailable?: number;
      qty_on_hand?: string;
      total_value?: string;
      remnant_lots?: number;
    }
  >;
  alerts: {
    calibration_due: number;
    maintenance_due: number;
    lost: number;
    stagnant_lots: number;
    stagnant_value: string;
  };
  by_location: Array<{ name: string; lots: number }>;
}

// ── 產線 ────────────────────────────────────────────────────────────
export interface ProductionLine {
  id: number;
  code: string;
  name: string;
  status: string;
  status_label: string;
  current_work: string;
  utilization: string | null;
  today_output: string;
  updated_by_name: string;
  updated_at: string;
}

export interface LinesData {
  results: ProductionLine[];
  summary: { total: number; running: number; avg_utilization: number | null };
  data_source: string;
}

// ── 選項 ────────────────────────────────────────────────────────────
export interface OptionsData {
  status: Option[];
  project_type: Option[];
  unit_type: Option[];
  work_mode: Option[];
  rollback_reason: Option[];
  trigger_type: Option[];
  claim_state: Option[];
  milestone_state: Option[];
  item_kind: Option[];
  asset_status: Option[];
  asset_movement_type: Option[];
  lot_status: Option[];
  aging_status: Option[];
  location_type: Option[];
  line_status: Option[];
  profile_type: Option[];
  change_order_status: Option[];
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
