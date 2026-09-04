/**
 * 設定
 *
 * 回答的問題：**公司的基本資料要怎麼改**。
 *
 * 客戶、廠商、員工這三個是每週都會動的東西，所以搬到前端來。
 * 物品主檔、位置階層、階段流程留在 Django Admin——欄位多、動得少，
 * Admin 的表單處理得比自己刻的好（決策 D26）。
 */
import { Boxes, Building2, KeyRound, ListChecks, Pencil, Plus, Truck, Users } from "lucide-react";
import { useState } from "react";

import { ApiError, api } from "@/api/client";
import { useOptions } from "@/api/hooks";
import { useCurrentUser } from "@/api/hooks/useAuth";
import FlowTemplateBoard from "@/components/forms/FlowTemplateBoard";
import StageBoard from "@/components/settings/StageBoard";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  FormErrors,
  inputClass,
  Modal,
  SearchInput,
  Segmented,
  SectionTitle,
  Select,
  Spinner,
} from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

type Tab = "customers" | "vendors" | "employees" | "flows" | "stages";

interface Customer {
  id: number;
  code: string;
  name: string;
  tax_id: string;
  contact_name: string;
  contact_phone: string;
  address: string;
  note: string;
  is_active: boolean;
  project_count: number;
}

interface Vendor {
  id: number;
  code: string;
  name: string;
  vendor_types: string[];
  type_display: string;
  tax_id: string;
  contact_name: string;
  contact_phone: string;
  address: string;
  payment_terms: string;
  note: string;
  is_active: boolean;
}

interface Employee {
  id: number;
  username: string;
  employee_no: string | null;
  name: string;
  title: string;
  phone: string;
  email: string;
  department: number | null;
  department_name: string;
  roles: string[];
  role_labels: string[];
  is_active: boolean;
  must_change_password: boolean;
  last_login: string | null;
}

const TABS: Array<{ key: Tab; label: string; icon: typeof Building2 }> = [
  { key: "customers", label: "客戶", icon: Building2 },
  { key: "vendors", label: "廠商", icon: Truck },
  { key: "employees", label: "員工", icon: Users },
  // 流程模板（D49）只給經理與系統管理員——列表渲染時再過濾
  { key: "flows", label: "流程模板", icon: ListChecks },
  // 構件批次站別（D54：Django Admin 移除後搬過來的），同樣只給經理
  { key: "stages", label: "批次站別", icon: Boxes },
];

export default function Settings() {
  const [tab, setTab] = useState<Tab>("customers");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<unknown | null>(null);
  const [creating, setCreating] = useState(false);
  // 頁面所有人都看得到（查同事分機、客戶聯絡人）；改只有經理與系統管理員（D40）
  const { data: user } = useCurrentUser();
  const canEdit = Boolean(user?.permissions.manage_masters);

  const list = useQuery({
    queryKey: ["admin", tab, q],
    queryFn: () =>
      api.get<{ count: number; results: unknown[] }>(`/${tab}`, {
        q: q || undefined,
        page_size: 100,
      }),
    // 流程模板與批次站別有自己的資料流，不走這支通用清單
    enabled: !["flows", "stages"].includes(tab),
  });

  const close = () => {
    setEditing(null);
    setCreating(false);
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {/* 邊界標示的頂排選項（D50） */}
        <Segmented
          value={tab}
          onChange={(v) => {
            setTab(v as Tab);
            setQ("");
          }}
          options={TABS.filter((t) => !["flows", "stages"].includes(t.key) || canEdit).map((t) => ({
            value: t.key,
            label: (
              <>
                <t.icon size={14} />
                {t.label}
              </>
            ),
          }))}
        />
        {tab !== "flows" && (
          <>
            <SearchInput value={q} onChange={setQ} placeholder="搜尋名稱或代號…" />
            {canEdit && (
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus size={15} />
                新增
              </Button>
            )}
          </>
        )}
      </div>

      {tab === "flows" ? (
        <FlowTemplateBoard />
      ) : tab === "stages" ? (
        <StageBoard />
      ) : list.isLoading ? (
        <Spinner />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={list.refetch} />
      ) : !list.data?.results.length ? (
        <EmptyState title="沒有符合條件的資料" />
      ) : (
        <>
          <SectionTitle>共 {list.data.count} 筆</SectionTitle>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {tab === "customers" &&
              (list.data.results as Customer[]).map((c) => (
                <CustomerCard key={c.id} customer={c} onEdit={canEdit ? setEditing : undefined} />
              ))}
            {tab === "vendors" &&
              (list.data.results as Vendor[]).map((v) => (
                <VendorCard key={v.id} vendor={v} onEdit={canEdit ? setEditing : undefined} />
              ))}
            {tab === "employees" &&
              (list.data.results as Employee[]).map((e) => (
                <EmployeeCard key={e.id} employee={e} onEdit={canEdit ? setEditing : undefined} />
              ))}
          </ul>
        </>
      )}

      {canEdit && tab === "customers" && (
        <CustomerForm
          open={creating || editing !== null}
          onClose={close}
          customer={editing as Customer | null}
        />
      )}
      {canEdit && tab === "vendors" && (
        <VendorForm open={creating || editing !== null} onClose={close} vendor={editing as Vendor | null} />
      )}
      {canEdit && tab === "employees" && (
        <EmployeeForm
          open={creating || editing !== null}
          onClose={close}
          employee={editing as Employee | null}
        />
      )}
    </div>
  );
}

// ── 卡片 ───────────────────────────────────────────────────────────
function RowCard({
  title,
  subtitle,
  lines,
  inactive,
  badge,
  onEdit,
}: {
  title: string;
  subtitle: string;
  lines: string[];
  inactive: boolean;
  badge?: string;
  /** 沒有維護權限的人（唯讀）不給編輯鈕 */
  onEdit?: () => void;
}) {
  return (
    <Card as="li" className={`p-3 ${inactive ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-ink">
            {title}
            {inactive && <span className="ml-1.5 text-xs font-normal text-ink-3">已停用</span>}
          </p>
          <p className="truncate text-xs text-ink-3">{subtitle}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {badge && (
            <span className="rounded bg-page px-1.5 py-0.5 text-xs font-semibold text-ink-2">
              {badge}
            </span>
          )}
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              aria-label="編輯"
              className="h-7 min-h-0 rounded-lg p-1.5 text-ink-3 hover:bg-page"
            >
              <Pencil size={14} />
            </button>
          )}
        </div>
      </div>
      {lines.filter(Boolean).map((l, i) => (
        <p key={i} className="mt-1 text-xs text-ink-2">
          {l}
        </p>
      ))}
    </Card>
  );
}

function CustomerCard({ customer: c, onEdit }: { customer: Customer; onEdit?: (c: Customer) => void }) {
  return (
    <RowCard
      title={c.name}
      subtitle={`${c.code}${c.tax_id ? ` · 統編 ${c.tax_id}` : ""}`}
      lines={[
        [c.contact_name, c.contact_phone].filter(Boolean).join(" · "),
        c.address,
      ]}
      inactive={!c.is_active}
      badge={c.project_count > 0 ? `${c.project_count} 案` : undefined}
      onEdit={onEdit && (() => onEdit(c))}
    />
  );
}

function VendorCard({ vendor: v, onEdit }: { vendor: Vendor; onEdit?: (v: Vendor) => void }) {
  return (
    <RowCard
      title={v.name}
      subtitle={`${v.code} · ${v.type_display}`}
      lines={[
        [v.contact_name, v.contact_phone].filter(Boolean).join(" · "),
        v.payment_terms && `付款：${v.payment_terms}`,
      ].filter(Boolean) as string[]}
      inactive={!v.is_active}
      onEdit={onEdit && (() => onEdit(v))}
    />
  );
}

function EmployeeCard({ employee: e, onEdit }: { employee: Employee; onEdit?: (e: Employee) => void }) {
  return (
    <RowCard
      title={e.name}
      subtitle={`${e.username}${e.employee_no ? ` · ${e.employee_no}` : ""}${e.title ? ` · ${e.title}` : ""}`}
      lines={[
        e.role_labels.join("、"),
        [e.department_name, e.phone].filter(Boolean).join(" · "),
        e.must_change_password ? "尚未變更預設密碼" : "",
      ]}
      inactive={!e.is_active}
      onEdit={onEdit && (() => onEdit(e))}
    />
  );
}

// ── 表單 ───────────────────────────────────────────────────────────
function useSave<T>(path: string, id: number | undefined, onDone: (saved: T) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      id ? api.patch<T>(`${path}/${id}`, body) : api.post<T>(path, body),
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ["admin"] });
      qc.invalidateQueries({ queryKey: ["options"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
      onDone(saved);
    },
  });
}

function CustomerForm({
  open,
  onClose,
  customer,
}: {
  open: boolean;
  onClose: () => void;
  customer: Customer | null;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    code: "", name: "", tax_id: "", contact_name: "", contact_phone: "",
    address: "", note: "", is_active: true,
  });
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const key = customer ? `edit-${customer.id}` : "new";
  if (open && loadedKey !== key) {
    setLoadedKey(key);
    setForm(
      customer
        ? { ...customer }
        : { code: "", name: "", tax_id: "", contact_name: "", contact_phone: "", address: "", note: "", is_active: true },
    );
  }
  if (!open && loadedKey !== null) setLoadedKey(null);

  const save = useSave<Customer>("/customers", customer?.id, (saved) => {
    toast.success(customer ? `${saved.name} 已更新` : `已新增客戶「${saved.name}」`);
    onClose();
  });
  const error = save.error instanceof ApiError ? save.error : null;
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal open={open} onClose={onClose} title={customer ? "修改客戶" : "新增客戶"}>
      <div className="grid grid-cols-[110px_1fr] gap-3">
        <Field label="客戶代號" required error={error?.fieldError("code")}>
          <input value={form.code} onChange={(e) => set("code")(e.target.value)} className={inputClass} />
        </Field>
        <Field label="客戶名稱" required error={error?.fieldError("name")}>
          <input value={form.name} onChange={(e) => set("name")(e.target.value)} className={inputClass} />
        </Field>
      </div>
      <Field label="統一編號" hint="8 位數字" error={error?.fieldError("tax_id")}>
        <input value={form.tax_id} onChange={(e) => set("tax_id")(e.target.value)} className={inputClass} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="聯絡人">
          <input value={form.contact_name} onChange={(e) => set("contact_name")(e.target.value)} className={inputClass} />
        </Field>
        <Field label="聯絡電話">
          <input value={form.contact_phone} onChange={(e) => set("contact_phone")(e.target.value)} className={inputClass} />
        </Field>
      </div>
      <Field label="地址">
        <input value={form.address} onChange={(e) => set("address")(e.target.value)} className={inputClass} />
      </Field>
      <Field label="備註">
        <input value={form.note} onChange={(e) => set("note")(e.target.value)} className={inputClass} />
      </Field>
      <ActiveToggle
        value={form.is_active}
        onChange={(v) => setForm((f) => ({ ...f, is_active: v }))}
        hint="有案子的客戶不能刪除，只能停用——歷史資料要留著"
      />

      <FormErrors error={error} handled={["code", "name", "tax_id"]} />
      <Actions
        onCancel={onClose}
        onSubmit={() => save.mutate(form)}
        loading={save.isPending}
        disabled={!form.code.trim() || !form.name.trim()}
      />
    </Modal>
  );
}

function VendorForm({
  open,
  onClose,
  vendor,
}: {
  open: boolean;
  onClose: () => void;
  vendor: Vendor | null;
}) {
  const toast = useToast();
  const { data: options } = useOptions();
  const [form, setForm] = useState({
    code: "", name: "", vendor_types: [] as string[], tax_id: "",
    contact_name: "", contact_phone: "", address: "", payment_terms: "",
    note: "", is_active: true,
  });
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const key = vendor ? `edit-${vendor.id}` : "new";
  if (open && loadedKey !== key) {
    setLoadedKey(key);
    setForm(
      vendor
        ? { ...vendor }
        : { code: "", name: "", vendor_types: [], tax_id: "", contact_name: "", contact_phone: "", address: "", payment_terms: "", note: "", is_active: true },
    );
  }
  if (!open && loadedKey !== null) setLoadedKey(null);

  const save = useSave<Vendor>("/vendors", vendor?.id, (saved) => {
    toast.success(vendor ? `${saved.name} 已更新` : `已新增廠商「${saved.name}」`);
    onClose();
  });
  const error = save.error instanceof ApiError ? save.error : null;
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const VENDOR_TYPES = [
    { value: "supplier", label: "供應商" },
    { value: "subcontractor", label: "分包商" },
    { value: "outsource", label: "外包加工" },
    { value: "transport", label: "運輸行" },
  ];

  function toggleType(t: string) {
    setForm((f) => ({
      ...f,
      vendor_types: f.vendor_types.includes(t)
        ? f.vendor_types.filter((x) => x !== t)
        : [...f.vendor_types, t],
    }));
  }

  return (
    <Modal open={open} onClose={onClose} title={vendor ? "修改廠商" : "新增廠商"}>
      <div className="grid grid-cols-[110px_1fr] gap-3">
        <Field label="廠商代號" required error={error?.fieldError("code")}>
          <input value={form.code} onChange={(e) => set("code")(e.target.value)} className={inputClass} />
        </Field>
        <Field label="廠商名稱" required error={error?.fieldError("name")}>
          <input value={form.name} onChange={(e) => set("name")(e.target.value)} className={inputClass} />
        </Field>
      </div>

      <Field
        label="廠商類型"
        required
        hint="可複選。一家廠商可以既是供應商也是運輸行"
        error={error?.fieldError("vendor_types")}
      >
        <div className="flex flex-wrap gap-2">
          {VENDOR_TYPES.map((t) => {
            const on = form.vendor_types.includes(t.value);
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => toggleType(t.value)}
                className={[
                  "h-9 min-h-0 rounded-lg px-3 text-xs font-semibold transition-base",
                  on ? "bg-stage-2 text-white" : "bg-page text-ink-2",
                ].join(" ")}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="統一編號">
        <input value={form.tax_id} onChange={(e) => set("tax_id")(e.target.value)} className={inputClass} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="聯絡人">
          <input value={form.contact_name} onChange={(e) => set("contact_name")(e.target.value)} className={inputClass} />
        </Field>
        <Field label="聯絡電話">
          <input value={form.contact_phone} onChange={(e) => set("contact_phone")(e.target.value)} className={inputClass} />
        </Field>
      </div>
      <Field label="付款條件" hint="如「月結 60 天」">
        <input value={form.payment_terms} onChange={(e) => set("payment_terms")(e.target.value)} className={inputClass} />
      </Field>
      <Field label="地址">
        <input value={form.address} onChange={(e) => set("address")(e.target.value)} className={inputClass} />
      </Field>
      <ActiveToggle
        value={form.is_active}
        onChange={(v) => setForm((f) => ({ ...f, is_active: v }))}
        hint="被追蹤單元引用過的廠商不能刪除，只能停用"
      />

      <FormErrors error={error} handled={["code", "name", "vendor_types"]} />
      <Actions
        onCancel={onClose}
        onSubmit={() => save.mutate(form)}
        loading={save.isPending}
        disabled={!form.code.trim() || !form.name.trim() || !form.vendor_types.length}
      />
      {options === undefined && null}
    </Modal>
  );
}

function EmployeeForm({
  open,
  onClose,
  employee,
}: {
  open: boolean;
  onClose: () => void;
  employee: Employee | null;
}) {
  const toast = useToast();
  const { data: options } = useOptions();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    username: "", employee_no: "", name: "", title: "", phone: "", email: "",
    department: "", roles: [] as string[], is_active: true,
  });
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const key = employee ? `edit-${employee.id}` : "new";
  if (open && loadedKey !== key) {
    setLoadedKey(key);
    setForm(
      employee
        ? {
            username: employee.username,
            employee_no: employee.employee_no ?? "",
            name: employee.name,
            title: employee.title,
            phone: employee.phone,
            email: employee.email,
            department: employee.department ? String(employee.department) : "",
            roles: employee.roles,
            is_active: employee.is_active,
          }
        : { username: "", employee_no: "", name: "", title: "", phone: "", email: "", department: "", roles: [], is_active: true },
    );
  }
  if (!open && loadedKey !== null) setLoadedKey(null);

  const departments = useQuery({
    queryKey: ["admin", "departments"],
    queryFn: () => api.get<Array<{ id: number; name: string }>>("/departments"),
    enabled: open,
    staleTime: 10 * 60 * 1000,
  });

  const save = useSave<Employee>("/employees", employee?.id, (saved) => {
    toast.success(
      employee ? `${saved.name} 已更新` : `已新增員工「${saved.name}」`,
      employee ? [] : [`帳號 ${saved.username}，預設密碼 28494320，首次登入必須自行修改`],
    );
    onClose();
  });

  const reset = useMutation({
    mutationFn: () => api.post<{ message: string }>(`/employees/${employee!.id}/reset-password`),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["admin"] });
      toast.warn(r.message, ["密碼重設會留下系統紀錄"]);
    },
  });

  const error = save.error instanceof ApiError ? save.error : null;
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  function toggleRole(code: string) {
    setForm((f) => ({
      ...f,
      roles: f.roles.includes(code) ? f.roles.filter((x) => x !== code) : [...f.roles, code],
    }));
  }

  return (
    <Modal open={open} onClose={onClose} title={employee ? `修改 ${employee.name}` : "新增員工"}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="帳號" required hint="登入用，建立後不建議改" error={error?.fieldError("username")}>
          <input
            value={form.username}
            onChange={(e) => set("username")(e.target.value)}
            autoCapitalize="none"
            className={inputClass}
          />
        </Field>
        <Field label="姓名" required error={error?.fieldError("name")}>
          <input value={form.name} onChange={(e) => set("name")(e.target.value)} className={inputClass} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="員工編號">
          <input value={form.employee_no} onChange={(e) => set("employee_no")(e.target.value)} className={inputClass} />
        </Field>
        <Field label="職稱">
          <input value={form.title} onChange={(e) => set("title")(e.target.value)} className={inputClass} />
        </Field>
      </div>

      <Field
        label="角色"
        required
        hint="★ 角色決定這個人登入後看得到什麼、能做什麼。可複選，權限取聯集"
        error={error?.fieldError("roles")}
      >
        <div className="flex flex-wrap gap-1.5">
          {(options?.role ?? []).map((r) => {
            const on = form.roles.includes(r.value);
            return (
              <button
                key={r.value}
                type="button"
                onClick={() => toggleRole(r.value)}
                className={[
                  "h-9 min-h-0 rounded-lg px-2.5 text-xs font-semibold transition-base",
                  on ? "bg-stage-2 text-white" : "bg-page text-ink-2",
                ].join(" ")}
              >
                {r.label}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="部門">
        <Select
          value={form.department}
          onChange={set("department")}
          options={(departments.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
          placeholder="未指定"
          className="w-full"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="手機">
          <input value={form.phone} onChange={(e) => set("phone")(e.target.value)} className={inputClass} />
        </Field>
        <Field label="電子郵件">
          <input type="email" value={form.email} onChange={(e) => set("email")(e.target.value)} className={inputClass} />
        </Field>
      </div>

      <ActiveToggle
        value={form.is_active}
        onChange={(v) => setForm((f) => ({ ...f, is_active: v }))}
        hint="離職請「停用」而不是刪除——他做過的推進、簽收、請款異動都掛在他名下，刪了歷史就斷了"
      />

      {employee && (
        <div className="mb-3 rounded-lg bg-page px-3 py-2.5">
          <p className="text-xs text-ink-2">
            密碼不在這張表單裡改。忘記密碼時用下面的按鈕重設成預設值，
            對方下次登入必須自行修改。
          </p>
          <Button className="mt-2" onClick={() => reset.mutate()} loading={reset.isPending}>
            <KeyRound size={13} />
            重設密碼
          </Button>
        </div>
      )}

      <FormErrors error={error} handled={["username", "name", "roles"]} />
      <Actions
        onCancel={onClose}
        onSubmit={() =>
          save.mutate({
            ...form,
            employee_no: form.employee_no || null,
            department: form.department ? Number(form.department) : null,
          })
        }
        loading={save.isPending}
        disabled={!form.username.trim() || !form.name.trim() || !form.roles.length}
      />
    </Modal>
  );
}

// ── 小片段 ─────────────────────────────────────────────────────────
function ActiveToggle({
  value,
  onChange,
  hint,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  hint: string;
}) {
  return (
    <div className="mb-3">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 accent-[var(--color-stage-2)]"
        />
        <span className="text-xs font-semibold text-ink-2">啟用中</span>
      </label>
      <p className="mt-1 text-xs text-ink-3">{hint}</p>
    </div>
  );
}

function Actions({
  onCancel,
  onSubmit,
  loading,
  disabled,
}: {
  onCancel: () => void;
  onSubmit: () => void;
  loading: boolean;
  disabled: boolean;
}) {
  return (
    <div className="flex gap-2">
      <Button onClick={onCancel} className="flex-1">
        取消
      </Button>
      <Button variant="primary" onClick={onSubmit} loading={loading} disabled={disabled} className="flex-1">
        儲存
      </Button>
    </div>
  );
}
