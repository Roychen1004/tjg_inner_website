/**
 * 資產相關表單
 *
 * 分成三支，因為問的問題根本不同：
 *   AssetForm    工具設備建檔 —— 一台一台，有財產編號，問「在誰手上」
 *   LotForm      建材入庫     —— 一批一批，有批號，問「還剩多少」
 *   AssetMoveForm 派用歸還    —— 一個動作同時改位置、持有人、專案
 *
 * 硬做成一支通用表單，結果會是三種情境都難用。
 */
import { useState } from "react";

import { ApiError, api } from "@/api/client";
import { useMoveAsset, useOptions } from "@/api/hooks";
import type { AssetUnit, Lot } from "@/api/types";
import { Button, Field, FormErrors, inputClass, Modal, Select } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

interface ItemOption {
  id: number;
  code: string;
  name: string;
  item_kind: string;
  tracking_mode: string;
  unit_of_measure: string;
  spec_label: string;
  material_grade: string;
  requires_mill_cert: boolean;
}

interface LocationOption {
  id: number;
  name: string;
  full_path: string;
  location_type: string;
}

function useItems(mode: "individual" | "quantity", enabled: boolean) {
  return useQuery({
    queryKey: ["items", mode],
    queryFn: () =>
      api.get<{ results: ItemOption[] }>("/items", { tracking_mode: mode, page_size: 100 }),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

function useLocations(enabled: boolean) {
  return useQuery({
    queryKey: ["locations", "all"],
    queryFn: () => api.get<LocationOption[]>("/locations"),
    enabled,
    staleTime: 10 * 60 * 1000,
  });
}

/** 物品主檔是空的時候，指出去哪裡建——不要讓人卡在一個空的下拉前面 */
function MasterDataHint({ what, path }: { what: string; path: string }) {
  return (
    <p
      className="mb-3 rounded-lg px-3 py-2 text-[11px] leading-relaxed"
      style={{ background: "var(--color-atrisk-bg)", color: "var(--color-atrisk)" }}
    >
      還沒有可選的{what}。{what}屬於<strong>主檔</strong>，
      請由系統管理員到 <code className="font-mono">{path}</code> 建立後再回來。
    </p>
  );
}

// ── 工具設備建檔 ───────────────────────────────────────────────────
export function AssetForm({
  open,
  onClose,
  asset,
}: {
  open: boolean;
  onClose: () => void;
  asset?: AssetUnit | null;
}) {
  const { data: options } = useOptions();
  const toast = useToast();
  const qc = useQueryClient();
  const items = useItems("individual", open);
  const locations = useLocations(open);

  const [form, setForm] = useState({
    asset_no: "", item: "", brand: "", model: "", serial_no: "",
    location: "", holder: "", current_project: "", asset_status: "idle",
    purchase_date: "", purchase_cost: "", calibration_due_date: "",
    next_maintenance_date: "", note: "",
  });
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  const key = asset ? `edit-${asset.id}` : "new";
  if (open && loadedKey !== key) {
    setLoadedKey(key);
    setForm(
      asset
        ? {
            asset_no: asset.asset_no, item: String(asset.item ?? ""),
            brand: asset.brand, model: asset.model, serial_no: asset.serial_no,
            location: String(asset.location), holder: asset.holder ? String(asset.holder) : "",
            current_project: asset.current_project ? String(asset.current_project) : "",
            asset_status: asset.asset_status,
            purchase_date: asset.purchase_date ?? "", purchase_cost: "",
            calibration_due_date: asset.calibration_due_date ?? "",
            next_maintenance_date: asset.next_maintenance_date ?? "",
            note: asset.note,
          }
        : {
            asset_no: "", item: "", brand: "", model: "", serial_no: "",
            location: "", holder: "", current_project: "", asset_status: "idle",
            purchase_date: "", purchase_cost: "", calibration_due_date: "",
            next_maintenance_date: "", note: "",
          },
    );
  }
  if (!open && loadedKey !== null) setLoadedKey(null);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      asset
        ? api.patch<AssetUnit>(`/assets/${asset.id}`, body)
        : api.post<AssetUnit>("/assets", body),
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ["assets"] });
      toast.success(asset ? `${saved.asset_no} 已更新` : `已建檔：${saved.asset_no} ${saved.item_name}`);
      close();
    },
  });
  const error = save.error instanceof ApiError ? save.error : null;

  function close() {
    save.reset();
    onClose();
  }

  function submit() {
    save.mutate({
      asset_no: form.asset_no.trim(),
      item: Number(form.item),
      brand: form.brand, model: form.model, serial_no: form.serial_no,
      location: Number(form.location),
      holder: form.holder ? Number(form.holder) : null,
      current_project: form.current_project ? Number(form.current_project) : null,
      asset_status: form.asset_status,
      purchase_date: form.purchase_date || null,
      purchase_cost: form.purchase_cost || null,
      calibration_due_date: form.calibration_due_date || null,
      next_maintenance_date: form.next_maintenance_date || null,
      note: form.note,
    });
  }

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const noItems = items.data && items.data.results.length === 0;

  return (
    <Modal open={open} onClose={close} title={asset ? `修改 ${asset.asset_no}` : "工具設備建檔"}>
      {noItems && <MasterDataHint what="工具／設備品項" path="/admin/masters/item/" />}

      <Field label="財產編號" required hint="公司自訂，如 TL-0031。這是這一台的身分證" error={error?.fieldError("asset_no")}>
        <input
          value={form.asset_no}
          onChange={(e) => set("asset_no")(e.target.value)}
          className={inputClass}
        />
      </Field>

      <Field label="品項" required error={error?.fieldError("item")}>
        <Select
          value={form.item}
          onChange={set("item")}
          options={(items.data?.results ?? []).map((i) => ({
            value: i.id, label: `${i.name}（${i.code}）`,
          }))}
          placeholder="請選擇"
          className="w-full"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="廠牌">
          <input value={form.brand} onChange={(e) => set("brand")(e.target.value)} className={inputClass} />
        </Field>
        <Field label="型號">
          <input value={form.model} onChange={(e) => set("model")(e.target.value)} className={inputClass} />
        </Field>
      </div>

      <Field label="製造商序號" hint="遺失報案或保固時會用到">
        <input value={form.serial_no} onChange={(e) => set("serial_no")(e.target.value)} className={inputClass} />
      </Field>

      <Field label="存放位置" required error={error?.fieldError("location")}>
        <Select
          value={form.location}
          onChange={set("location")}
          options={(locations.data ?? []).map((l) => ({ value: l.id, label: l.full_path }))}
          placeholder="請選擇"
          className="w-full"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="目前持有人">
          <Select
            value={form.holder}
            onChange={set("holder")}
            options={(options?.users ?? []).map((u) => ({ value: u.id, label: u.name }))}
            placeholder="在庫"
            className="w-full"
          />
        </Field>
        <Field label="狀態">
          <Select
            value={form.asset_status}
            onChange={set("asset_status")}
            options={options?.asset_status ?? []}
            className="w-full"
          />
        </Field>
      </div>

      <Field label="使用於哪個案子">
        <Select
          value={form.current_project}
          onChange={set("current_project")}
          options={(options?.projects ?? []).map((p) => ({ value: p.id, label: p.name }))}
          placeholder="未指定"
          className="w-full"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="購置日">
          <input type="date" value={form.purchase_date} onChange={(e) => set("purchase_date")(e.target.value)} className={inputClass} />
        </Field>
        <Field label="購置成本">
          <input type="number" inputMode="numeric" value={form.purchase_cost} onChange={(e) => set("purchase_cost")(e.target.value)} className={inputClass} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="下次校驗日" hint="扭力扳手、量具、吊具">
          <input type="date" value={form.calibration_due_date} onChange={(e) => set("calibration_due_date")(e.target.value)} className={inputClass} />
        </Field>
        <Field label="下次保養日">
          <input type="date" value={form.next_maintenance_date} onChange={(e) => set("next_maintenance_date")(e.target.value)} className={inputClass} />
        </Field>
      </div>
      <p className="-mt-1 mb-3 text-[11px] text-ink-3">
        填了日期，到期時會自動出現在「需要關注」——不用有人記得。
      </p>

      <Field label="備註">
        <input value={form.note} onChange={(e) => set("note")(e.target.value)} className={inputClass} />
      </Field>

      <FormErrors error={error} handled={["asset_no", "item", "location"]} />
      <FormActions
        onCancel={close}
        onSubmit={submit}
        loading={save.isPending}
        disabled={!form.asset_no.trim() || !form.item || !form.location}
        label={asset ? "儲存" : "建檔"}
      />
    </Modal>
  );
}

// ── 建材入庫 ───────────────────────────────────────────────────────
export function LotForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: options } = useOptions();
  const toast = useToast();
  const qc = useQueryClient();
  const items = useItems("quantity", open);
  const locations = useLocations(open);

  const [form, setForm] = useState({
    item: "", location: "", qty: "", lot_no: "", unit_cost: "",
    mill_cert_no: "", heat_no: "", source_po_no: "",
    reserved_for_project: "", received_date: new Date().toISOString().slice(0, 10), note: "",
  });

  const selected = items.data?.results.find((i) => String(i.id) === form.item);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<Lot>("/lots", body),
    onSuccess: (lot) => {
      qc.invalidateQueries({ queryKey: ["assets"] });
      toast.success(`已入庫：${lot.item_name} ${Number(lot.qty_on_hand)} ${lot.unit_of_measure}`, [
        `批號 ${lot.lot_no}，存放於 ${lot.location_path}`,
      ]);
      setForm((f) => ({ ...f, qty: "", lot_no: "", mill_cert_no: "", heat_no: "", note: "" }));
      onClose();
    },
  });
  const error = save.error instanceof ApiError ? save.error : null;

  function submit() {
    save.mutate({
      item: Number(form.item),
      location: Number(form.location),
      qty: form.qty,
      lot_no: form.lot_no,
      unit_cost: form.unit_cost || null,
      mill_cert_no: form.mill_cert_no,
      heat_no: form.heat_no,
      source_po_no: form.source_po_no,
      reserved_for_project: form.reserved_for_project ? Number(form.reserved_for_project) : null,
      received_date: form.received_date || null,
      note: form.note,
    });
  }

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const noItems = items.data && items.data.results.length === 0;

  return (
    <Modal
      open={open}
      onClose={() => {
        save.reset();
        onClose();
      }}
      title="建材入庫"
    >
      <p className="mb-4 rounded-lg bg-page px-3 py-2 text-[11px] leading-relaxed text-ink-2">
        用於<strong>期初盤點建檔</strong>（把倉庫現有的料一次建進系統）與零星補料。
        P2 導入採購模組後，收料會由採購單自動帶出來，不用手打。
      </p>

      {noItems && <MasterDataHint what="建材／零件品項" path="/admin/masters/item/" />}

      <Field label="品項" required hint="規格、材質、尺寸都掛在品項上，選了就自動帶出來" error={error?.fieldError("item")}>
        <Select
          value={form.item}
          onChange={set("item")}
          options={(items.data?.results ?? []).map((i) => ({
            value: i.id,
            label: `${i.name}${i.spec_label ? ` ${i.spec_label}` : ""}${i.material_grade ? ` ${i.material_grade}` : ""}`,
          }))}
          placeholder="請選擇"
          className="w-full"
        />
      </Field>

      <div className="grid grid-cols-[1fr_70px] gap-3">
        <Field label="數量" required error={error?.fieldError("qty")}>
          <input
            type="number"
            inputMode="decimal"
            value={form.qty}
            onChange={(e) => set("qty")(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="單位">
          <input value={selected?.unit_of_measure ?? ""} disabled className={inputClass} />
        </Field>
      </div>

      <Field label="存放位置" required error={error?.fieldError("location")}>
        <Select
          value={form.location}
          onChange={set("location")}
          options={(locations.data ?? []).map((l) => ({ value: l.id, label: l.full_path }))}
          placeholder="請選擇"
          className="w-full"
        />
      </Field>

      <Field label="批號" hint="留空由系統產生（料號-年月-序號）">
        <input value={form.lot_no} onChange={(e) => set("lot_no")(e.target.value)} className={inputClass} />
      </Field>

      {selected?.requires_mill_cert && (
        <>
          <p
            className="mb-3 rounded-lg px-3 py-2 text-[11px] leading-relaxed"
            style={{ background: "var(--color-atrisk-bg)", color: "var(--color-atrisk)" }}
          >
            這個品項<strong>需要材質證明</strong>。沒有材證的鋼材日後查不出爐號，
            業主查驗時會出問題，所以這裡擋著不讓過。
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="材證編號" required error={error?.fieldError("mill_cert_no")}>
              <input value={form.mill_cert_no} onChange={(e) => set("mill_cert_no")(e.target.value)} className={inputClass} />
            </Field>
            <Field label="爐號" hint="鋼材追溯用">
              <input value={form.heat_no} onChange={(e) => set("heat_no")(e.target.value)} className={inputClass} />
            </Field>
          </div>
        </>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="單位成本">
          <input type="number" inputMode="decimal" value={form.unit_cost} onChange={(e) => set("unit_cost")(e.target.value)} className={inputClass} />
        </Field>
        <Field label="入庫日">
          <input type="date" value={form.received_date} onChange={(e) => set("received_date")(e.target.value)} className={inputClass} />
        </Field>
      </div>

      <Field label="指定給哪個案子" hint="填了就是專料專用，其他案子領不走">
        <Select
          value={form.reserved_for_project}
          onChange={set("reserved_for_project")}
          options={(options?.projects ?? []).map((p) => ({ value: p.id, label: p.name }))}
          placeholder="共用庫存"
          className="w-full"
        />
      </Field>

      <Field label="來源採購單號">
        <input value={form.source_po_no} onChange={(e) => set("source_po_no")(e.target.value)} className={inputClass} />
      </Field>

      <FormErrors error={error} handled={["item", "location", "qty", "mill_cert_no"]} />
      <FormActions
        onCancel={() => {
          save.reset();
          onClose();
        }}
        onSubmit={submit}
        loading={save.isPending}
        disabled={!form.item || !form.location || !form.qty}
        label="入庫"
      />
    </Modal>
  );
}

// ── 派用／歸還 ─────────────────────────────────────────────────────
export function AssetMoveForm({
  asset,
  onClose,
}: {
  asset: AssetUnit | null;
  onClose: () => void;
}) {
  const { data: options } = useOptions();
  const locations = useLocations(asset !== null);
  const move = useMoveAsset();
  const toast = useToast();
  const [form, setForm] = useState({
    movement_type: "assign", to_holder: "", to_location: "", to_project: "", note: "",
  });

  const error = move.error instanceof ApiError ? move.error : null;

  function submit() {
    if (!asset) return;
    move.mutate(
      {
        id: asset.id,
        movement_type: form.movement_type,
        to_holder: form.to_holder ? Number(form.to_holder) : null,
        to_location: form.to_location ? Number(form.to_location) : null,
        to_project: form.to_project ? Number(form.to_project) : null,
        note: form.note,
      },
      {
        onSuccess: (r) => {
          toast.success(`${asset.asset_no} → ${r.asset.status_label}`, [
            r.asset.holder_name ? `持有人：${r.asset.holder_name}` : "已歸還在庫",
          ]);
          onClose();
        },
      },
    );
  }

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal open={asset !== null} onClose={onClose} title={`${asset?.asset_no ?? ""} 異動`}>
      <p className="mb-4 text-xs text-ink-2">
        {asset?.item_name}
        <span className="ml-2 text-ink-3">
          目前：{asset?.holder_name || "在庫"} · {asset?.location_name}
        </span>
      </p>

      <Field label="異動類型" required hint="狀態由類型自動推導，不用另外選——選錯就對不上了">
        <Select
          value={form.movement_type}
          onChange={set("movement_type")}
          options={options?.asset_movement_type ?? []}
          className="w-full"
        />
      </Field>

      <Field label="交給誰">
        <Select
          value={form.to_holder}
          onChange={set("to_holder")}
          options={(options?.users ?? []).map((u) => ({ value: u.id, label: u.name }))}
          placeholder="歸還在庫（不指定持有人）"
          className="w-full"
        />
      </Field>

      <Field label="移到哪裡">
        <Select
          value={form.to_location}
          onChange={set("to_location")}
          options={(locations.data ?? []).map((l) => ({ value: l.id, label: l.full_path }))}
          placeholder="位置不變"
          className="w-full"
        />
      </Field>

      <Field label="用在哪個案子">
        <Select
          value={form.to_project}
          onChange={set("to_project")}
          options={(options?.projects ?? []).map((p) => ({ value: p.id, label: p.name }))}
          placeholder="不指定"
          className="w-full"
        />
      </Field>

      <Field label="備註">
        <input value={form.note} onChange={(e) => set("note")(e.target.value)} className={inputClass} />
      </Field>

      <FormErrors error={error} />
      <FormActions onCancel={onClose} onSubmit={submit} loading={move.isPending} label="送出" />
    </Modal>
  );
}

// ── 共用小片段 ─────────────────────────────────────────────────────
function FormActions({
  onCancel,
  onSubmit,
  loading,
  disabled,
  label,
}: {
  onCancel: () => void;
  onSubmit: () => void;
  loading: boolean;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div className="flex gap-2">
      <Button onClick={onCancel} className="flex-1">
        取消
      </Button>
      <Button
        variant="primary"
        onClick={onSubmit}
        loading={loading}
        disabled={disabled}
        className="flex-1"
      >
        {label}
      </Button>
    </div>
  );
}
