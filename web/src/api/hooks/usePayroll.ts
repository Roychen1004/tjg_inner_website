/**
 * 薪資（D57）
 *
 * 單獨一個檔案而不是塞進 hooks/index：薪資頁是 lazy 載入的，
 * 從 index 拿會把整份 hooks 拉進那個 chunk（見 UI 原則）。
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../client";

// ── 型別 ───────────────────────────────────────────────────────────

/** 法規參數。全部可編輯——基本工資每年調，不該是程式裡的常數 */
export interface PayrollPolicy {
  id: number;
  name: string;
  effective_from: string | null;
  min_hourly_wage: string;
  normal_hours_per_day: string;
  default_daily_ot_hours: string;
  monthly_wage_divisor: string;
  ot_weekday_1_rate: string;
  ot_weekday_1_hours: string;
  ot_weekday_2_rate: string;
  ot_restday_1_rate: string;
  ot_restday_1_hours: string;
  ot_restday_2_rate: string;
  ot_restday_2_hours: string;
  ot_restday_3_rate: string;
  holiday_rate: string;
  labor_insurance_rate: string;
  labor_insurance_employee_share: string;
  labor_insurance_employer_share: string;
  health_insurance_rate: string;
  health_insurance_employee_share: string;
  health_insurance_employer_share: string;
  health_employer_head_factor: string;
  health_max_dependents: number;
  pension_employer_rate: string;
  welfare_fund_rate: string;
  daily_ot_hours_cap: string;
  monthly_ot_hours_cap: string;
}

export interface InsuranceGrade {
  id: number;
  level: number;
  amount: string;
  is_active: boolean;
}

/** 三種計薪方式。差別只在「應發總額怎麼來的」，之後的法規公式共用 */
export type PayType = "hourly" | "monthly_gross" | "monthly_net";

export interface SalaryProfile {
  id: number;
  user: number;
  user_name: string;
  employee_no: string | null;
  title: string;
  pay_type: PayType;
  pay_type_label: string;
  monthly_salary: string | null;
  hourly_wage: string | null;
  insured_salary: string;
  dependents: number;
  voluntary_pension_rate: string;
  hire_date: string | null;
  resign_date: string | null;
  is_active: boolean;
  note: string;
}

/** 一行算式：「平日加班（前 2 小時）　10 小時 × 196 × 1.34 ＝ 2,626」 */
export interface CalcRow {
  section: "earning" | "deduction" | "employer";
  label: string;
  formula: string;
  amount: string;
}

export interface PayrollLine {
  id: number;
  record: number;
  kind: "earning" | "deduction";
  kind_label: string;
  label: string;
  amount: string;
  note: string;
}

export interface PayrollRecord {
  id: number;
  period: number;
  user: number;
  user_name: string;
  employee_no: string | null;
  title: string;
  work_days: string;
  normal_hours: string;
  ot_weekday_1_hours: string;
  ot_weekday_2_hours: string;
  ot_restday_1_hours: string;
  ot_restday_2_hours: string;
  ot_restday_3_hours: string;
  holiday_hours: string;
  unpaid_leave_hours: string;
  late_minutes: number;
  early_leave_minutes: number;
  insured_days: number;
  charge_health_insurance: boolean;
  hourly_wage: string | null;
  monthly_salary: string | null;
  insured_salary: string | null;
  dependents: number | null;
  note: string;
  pay_type: PayType;
  pay_type_label: string;
  profile_monthly_salary: string | null;
  /** 實際採用的平日每小時工資額。月薪制是 月薪 ÷ 240 換算的 */
  effective_hourly_wage: string;
  gross: string;
  deduction: string;
  net: string;
  employer_cost: string;
  detail: CalcRow[];
  warnings: string[];
  lines: PayrollLine[];
}

export interface PayrollPeriod {
  id: number;
  year: number;
  month: number;
  label: string;
  workdays: string;
  normal_hours_per_day: string;
  daily_ot_hours: string;
  status: "draft" | "confirmed" | "paid";
  status_label: string;
  is_locked: boolean;
  note: string;
  confirmed_at: string | null;
  confirmed_by: number | null;
  confirmed_by_name: string | null;
  policy_snapshot: Record<string, string>;
  totals: {
    headcount: number;
    gross: string;
    deduction: string;
    net: string;
    employer_cost: string;
  };
}

/** 日曆上的一天。kind 決定顏色，name 是要顯示出來的文字 */
export type DayKind = "work" | "weekend" | "holiday" | "makeup";

export interface CalendarDay {
  date: string;
  day: number;
  /** 0=週一 … 6=週日（Python 的 weekday()） */
  weekday: number;
  kind: DayKind;
  name: string;
}

export interface PeriodSuggestion {
  year: number;
  month: number;
  weekdays: number;
  holidays: Array<{ date: string; name: string }>;
  workdays: string;
  normal_hours_per_day: string;
  daily_ot_hours: string;
  days: CalendarDay[];
}

/** 政府公告的級距表原檔 */
export interface ReferenceDocument {
  key: string;
  title: string;
  effective: string;
  note: string;
  issuer: string;
  /** 官方頁面（明年要看新版從這裡去；系統裡不留 PDF 副本） */
  source: string;
}

// ── 查詢 ───────────────────────────────────────────────────────────

export function usePayrollPolicy() {
  return useQuery({
    queryKey: ["payroll", "policy"],
    queryFn: () => api.get<PayrollPolicy>("/payroll-policy"),
  });
}

export function useInsuranceGrades() {
  return useQuery({
    queryKey: ["payroll", "grades"],
    queryFn: () => api.get<InsuranceGrade[]>("/payroll-grades"),
    staleTime: 30 * 60 * 1000,
  });
}

export function useSalaryProfiles() {
  return useQuery({
    queryKey: ["payroll", "profiles"],
    queryFn: () => api.get<SalaryProfile[]>("/salary-profiles"),
  });
}

export function usePayrollPeriods() {
  return useQuery({
    queryKey: ["payroll", "periods"],
    queryFn: () => api.get<PayrollPeriod[]>("/payroll-periods"),
  });
}

export function usePayrollRecords(periodId: number | null) {
  return useQuery({
    queryKey: ["payroll", "records", periodId],
    queryFn: () => api.get<PayrollRecord[]>("/payroll-records", { period: periodId }),
    enabled: periodId !== null,
  });
}

export interface Holiday {
  id: number;
  date: string;
  name: string;
  is_workday: boolean;
}

export function useHolidays(year: number) {
  return useQuery({
    queryKey: ["payroll", "holidays", year],
    queryFn: () => api.get<Holiday[]>("/payroll-holidays", { year }),
  });
}

/** 從政府資料開放平臺匯入某一年的辦公日曆表 */
export function useImportHolidays() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (year: number) =>
      api.post<{ created: number; updated: number; detail: string; source: string }>(
        `/payroll-holidays/import_year?year=${year}`,
      ),
    onSuccess: invalidate,
  });
}

export function useSaveHoliday() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<Holiday> & { id?: number }) =>
      id
        ? api.patch<Holiday>(`/payroll-holidays/${id}`, body)
        : api.post<Holiday>("/payroll-holidays", body),
    onSuccess: invalidate,
  });
}

export function useDeleteHoliday() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/payroll-holidays/${id}`),
    onSuccess: invalidate,
  });
}

export function usePayrollReferences() {
  return useQuery({
    queryKey: ["payroll", "references"],
    queryFn: () => api.get<ReferenceDocument[]>("/payroll-references"),
    staleTime: 60 * 60 * 1000,
  });
}

export function usePeriodSuggestion(year: number, month: number, enabled = true) {
  return useQuery({
    queryKey: ["payroll", "suggest", year, month],
    queryFn: () => api.get<PeriodSuggestion>("/payroll-periods/suggest", { year, month }),
    enabled,
  });
}

// ── 變更 ───────────────────────────────────────────────────────────

/** 薪資的任何變更都會牽動金額，一律把整包薪資快取作廢再重抓 */
function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["payroll"] });
}

export function useSavePolicy() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: Partial<PayrollPolicy>) =>
      api.patch<PayrollPolicy>("/payroll-policy", body),
    onSuccess: invalidate,
  });
}

export function useSyncProfiles() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: () => api.post<{ created: number; detail: string }>("/salary-profiles/sync"),
    onSuccess: invalidate,
  });
}

export function useSaveProfile() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<SalaryProfile> & { id: number }) =>
      api.patch<SalaryProfile>(`/salary-profiles/${id}`, body),
    onSuccess: invalidate,
  });
}

export function useCreatePeriod() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: {
      year: number;
      month: number;
      workdays?: string;
      normal_hours_per_day?: string;
      daily_ot_hours?: string;
    }) => api.post<PayrollPeriod>("/payroll-periods", body),
    onSuccess: invalidate,
  });
}

export function useSavePeriod() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<PayrollPeriod> & { id: number }) =>
      api.patch<PayrollPeriod>(`/payroll-periods/${id}`, body),
    onSuccess: invalidate,
  });
}

/**
 * 對整個月的動作。
 *
 * ★ 沒有「產生薪資單」——建立薪資單、更新保險天數、移除當月不在職者
 *   這些安全的事，後端會在建立月份／改設定時自己做。
 *   只有 reset-hours 會**覆蓋**已 key 的工時，所以它才需要是一顆明確的按鈕。
 */
export function usePeriodAction(
  action: "reset-hours" | "recalc" | "confirm" | "reopen" | "pay",
) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, deep }: { id: number; deep?: boolean }) =>
      api.post<{ detail?: string }>(
        `/payroll-periods/${id}/${action}${deep ? "?deep=true" : ""}`,
      ),
    onSuccess: invalidate,
  });
}

export function useSaveRecord() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<PayrollRecord> & { id: number }) =>
      api.patch<PayrollRecord>(`/payroll-records/${id}`, body),
    onSuccess: invalidate,
  });
}

export function useSaveLine() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<PayrollLine> & { id?: number }) =>
      id
        ? api.patch<PayrollLine>(`/payroll-lines/${id}`, body)
        : api.post<PayrollLine>("/payroll-lines", body),
    onSuccess: invalidate,
  });
}

export function useDeleteLine() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/payroll-lines/${id}`),
    onSuccess: invalidate,
  });
}
