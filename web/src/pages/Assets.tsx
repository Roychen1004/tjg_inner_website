/**
 * 資產總覽
 *
 * 回答的問題：**公司有什麼東西、在哪、什麼狀態、用在哪個案子**。
 *
 * 分兩種問法，因為問題本來就不同：
 *   工具設備（個體型）→「這支在誰手上」
 *   建材零件（數量型）→「還剩多少、什麼規格、放多久了」
 *
 * 硬把兩者塞進同一張表，會得到一張兩邊都答不好的表。
 */
import { ArrowLeftRight, MapPin, Package, Pencil, Plus, Ruler, Wrench } from "lucide-react";
import { useState } from "react";

import { useAssetSummary, useAssets, useLots, useOptions } from "@/api/hooks";
import { useCurrentUser } from "@/api/hooks/useAuth";
import type { AssetUnit, Lot } from "@/api/types";
import { AssetForm, AssetMoveForm, LotForm } from "@/components/forms/AssetForms";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  KpiCard,
  Money,
  SearchInput,
  SectionTitle,
  Select,
  Spinner,
} from "@/components/ui";

type Tab = "material" | "tool";

export default function Assets() {
  const [tab, setTab] = useState<Tab>("material");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const { data: options } = useOptions();
  const { data: user } = useCurrentUser();
  const { data: summary } = useAssetSummary();
  const [creating, setCreating] = useState(false);
  const [editingAsset, setEditingAsset] = useState<AssetUnit | null>(null);
  const [movingAsset, setMovingAsset] = useState<AssetUnit | null>(null);
  const canEdit = Boolean(user?.permissions.edit_assets);

  const lots = useLots(
    { q: q || undefined, status: status || undefined, page_size: 50 },
    tab === "material",
  );
  const assets = useAssets(
    { q: q || undefined, status: status || undefined, page_size: 50 },
    tab === "tool",
  );

  return (
    <div>
      {summary && (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {Object.entries(summary.by_kind).map(([kind, data]) => (
              <KpiCard
                key={kind}
                label={data.label}
                value={data.count}
                unit={data.mode === "individual" ? "件" : "批"}
                detail={
                  data.mode === "individual"
                    ? `使用中 ${data.in_use} · 閒置 ${data.idle}`
                    : `帳面 ${Math.round(Number(data.total_value ?? 0) / 10000).toLocaleString("zh-TW")} 萬`
                }
              />
            ))}
          </div>

          {(summary.alerts.calibration_due > 0 ||
            summary.alerts.stagnant_lots > 0 ||
            summary.alerts.lost > 0) && (
            <div
              className="mb-3 flex flex-wrap gap-x-4 gap-y-1 rounded-xl px-3 py-2.5 text-xs"
              style={{ background: "var(--color-atrisk-bg)", color: "var(--color-atrisk)" }}
            >
              {summary.alerts.calibration_due > 0 && (
                <span>{summary.alerts.calibration_due} 件已到校驗期</span>
              )}
              {summary.alerts.maintenance_due > 0 && (
                <span>{summary.alerts.maintenance_due} 件該保養</span>
              )}
              {summary.alerts.lost > 0 && <span>{summary.alerts.lost} 件遺失</span>}
              {summary.alerts.stagnant_lots > 0 && (
                <span>
                  {summary.alerts.stagnant_lots} 批呆滯料，占用{" "}
                  <Money value={summary.alerts.stagnant_value} compact /> 元
                </span>
              )}
            </div>
          )}
        </>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg bg-page p-0.5">
          {(
            [
              { key: "material", label: "建材零件", icon: Package },
              { key: "tool", label: "工具設備", icon: Wrench },
            ] as const
          ).map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                setTab(item.key);
                setStatus("");
              }}
              className={[
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-base",
                tab === item.key ? "bg-card text-ink shadow-sm" : "text-ink-2",
              ].join(" ")}
            >
              <item.icon size={13} />
              {item.label}
            </button>
          ))}
        </div>
        <SearchInput
          value={q}
          onChange={setQ}
          placeholder={tab === "material" ? "料號、品名、規格、爐號…" : "財產編號、品名、廠牌…"}
        />
        <Select
          value={status}
          onChange={setStatus}
          options={(tab === "material" ? options?.lot_status : options?.asset_status) ?? []}
          placeholder="全部狀態"
        />
        {canEdit && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={15} />
            {tab === "material" ? "建材入庫" : "工具建檔"}
          </Button>
        )}
      </div>

      {tab === "material" ? (
        lots.isLoading ? (
          <Spinner />
        ) : lots.error ? (
          <ErrorState error={lots.error} onRetry={lots.refetch} />
        ) : !lots.data?.results.length ? (
          <EmptyState
            title="沒有符合條件的庫存批"
            hint="建材是「數量型」——一批一批管，問的是還剩多少。先在 Admin 建好品項（規格、材質、尺寸），再從這裡入庫"
            action={
              canEdit ? (
                <Button variant="primary" onClick={() => setCreating(true)}>
                  <Plus size={14} />
                  建材入庫
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <SectionTitle>共 {lots.data.count} 批</SectionTitle>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {lots.data.results.map((lot) => (
                <LotCard key={lot.id} lot={lot} />
              ))}
            </ul>
          </>
        )
      ) : assets.isLoading ? (
        <Spinner />
      ) : assets.error ? (
        <ErrorState error={assets.error} onRetry={assets.refetch} />
      ) : !assets.data?.results.length ? (
        <EmptyState
          title="沒有符合條件的工具設備"
          hint="工具設備是「個體型」——一台一台管，有財產編號，問的是在誰手上"
          action={
            canEdit ? (
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus size={14} />
                工具建檔
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <SectionTitle>共 {assets.data.count} 件</SectionTitle>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {assets.data.results.map((asset) => (
              <AssetCard
                key={asset.id}
                asset={asset}
                onEdit={canEdit ? setEditingAsset : undefined}
                onMove={canEdit ? setMovingAsset : undefined}
              />
            ))}
          </ul>
        </>
      )}

      <LotForm open={creating && tab === "material"} onClose={() => setCreating(false)} />
      <AssetForm open={creating && tab === "tool"} onClose={() => setCreating(false)} />
      <AssetForm
        open={editingAsset !== null}
        onClose={() => setEditingAsset(null)}
        asset={editingAsset}
      />
      <AssetMoveForm asset={movingAsset} onClose={() => setMovingAsset(null)} />
    </div>
  );
}

// ── 建材／零件（數量型）───────────────────────────────────────────
const DIMENSION_LABELS: Record<string, string> = {
  thickness_mm: "厚",
  width_mm: "寬",
  height_mm: "高",
  length_mm: "長",
  diameter_mm: "外徑",
  web_thickness_mm: "腹板厚",
  flange_thickness_mm: "翼板厚",
};

function LotCard({ lot }: { lot: Lot }) {
  const dims = Object.entries(lot.dimensions).filter(([, v]) => v && Number(v) > 0);
  return (
    <Card as="li" className="p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-ink">{lot.item_name}</p>
          <p className="truncate text-[11px] text-ink-3">
            {lot.lot_no} · {lot.item_code}
          </p>
        </div>
        <span className="shrink-0 rounded bg-page px-1.5 py-0.5 text-[11px] font-semibold text-ink-2">
          {lot.status_label}
        </span>
      </div>

      {/* 規格是找料時真正在看的東西，放在最顯眼的位置 */}
      {(lot.spec_label || lot.material_grade) && (
        <p className="mt-1.5 text-xs font-semibold text-ink">
          {lot.spec_label}
          {lot.material_grade && (
            <span className="ml-1.5 font-normal text-ink-2">{lot.material_grade}</span>
          )}
          {lot.surface_treatment && (
            <span className="ml-1.5 font-normal text-ink-2">{lot.surface_treatment}</span>
          )}
        </p>
      )}

      {dims.length > 0 && (
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-2">
          <Ruler size={11} className="text-ink-3" />
          {dims.map(([k, v]) => (
            <span key={k}>
              {DIMENSION_LABELS[k] ?? k} {Number(v)}
            </span>
          ))}
        </p>
      )}

      <p className="mt-2 text-sm font-bold tabular-nums text-ink">
        {Number(lot.qty_available)}
        <span className="ml-0.5 text-xs font-normal text-ink-2">{lot.unit_of_measure}</span>
        {Number(lot.qty_reserved) > 0 && (
          <span className="ml-2 text-[11px] font-normal text-ink-3">
            （預留 {Number(lot.qty_reserved)}）
          </span>
        )}
        {lot.total_weight_kg && (
          <span className="ml-2 text-[11px] font-normal text-ink-3">
            {(Number(lot.total_weight_kg) / 1000).toFixed(2)} 噸
          </span>
        )}
      </p>

      <p className="mt-1.5 flex items-center gap-1 text-[11px] text-ink-2">
        <MapPin size={11} className="text-ink-3" />
        {lot.location_path}
      </p>

      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ink-3">
        {lot.reserved_for_project_name && (
          <span style={{ color: "var(--color-stage-2)" }}>
            指定給 {lot.reserved_for_project_name}
          </span>
        )}
        {lot.is_remnant && (
          <span>
            餘料
            {lot.parent_lot_no && `（源自 ${lot.parent_lot_no}）`}
          </span>
        )}
        {lot.heat_no && <span>爐號 {lot.heat_no}</span>}
        {lot.aging_days !== null && (
          <span
            style={{
              color:
                lot.aging_status === "normal" ? undefined : "var(--color-atrisk)",
            }}
          >
            庫齡 {lot.aging_days} 天 · {lot.aging_label}
          </span>
        )}
      </div>
    </Card>
  );
}

// ── 工具／設備（個體型）───────────────────────────────────────────
function AssetCard({
  asset,
  onEdit,
  onMove,
}: {
  asset: AssetUnit;
  onEdit?: (a: AssetUnit) => void;
  onMove?: (a: AssetUnit) => void;
}) {
  const overdue = asset.is_calibration_overdue || asset.is_maintenance_overdue;
  return (
    <Card as="li" className="p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-ink">{asset.item_name}</p>
          <p className="truncate text-[11px] text-ink-3">
            {asset.asset_no}
            {asset.brand && ` · ${asset.brand}`}
            {asset.model && ` ${asset.model}`}
          </p>
        </div>
        <span className="shrink-0 rounded bg-page px-1.5 py-0.5 text-[11px] font-semibold text-ink-2">
          {asset.status_label}
        </span>
      </div>

      <dl className="mt-2 space-y-1 text-[11px]">
        <div className="flex gap-1.5">
          <dt className="text-ink-3">持有</dt>
          <dd className="font-semibold text-ink">{asset.holder_name || "在庫"}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-ink-3">位置</dt>
          <dd className="text-ink-2">{asset.location_path}</dd>
        </div>
        {asset.current_project_name && (
          <div className="flex gap-1.5">
            <dt className="text-ink-3">用於</dt>
            <dd className="font-semibold" style={{ color: "var(--color-stage-2)" }}>
              {asset.current_project_name}
            </dd>
          </div>
        )}
      </dl>

      {overdue && (
        <p className="mt-2 text-[11px] font-semibold" style={{ color: "var(--color-delayed)" }}>
          {asset.is_calibration_overdue && `校驗已到期（${asset.calibration_due_date}）`}
          {asset.is_calibration_overdue && asset.is_maintenance_overdue && "、"}
          {asset.is_maintenance_overdue && `保養已到期（${asset.next_maintenance_date}）`}
        </p>
      )}

      {(onEdit || onMove) && (
        <div className="mt-2.5 flex gap-2">
          {onMove && (
            <Button variant="primary" onClick={() => onMove(asset)} className="flex-1">
              <ArrowLeftRight size={13} />
              派用／歸還
            </Button>
          )}
          {onEdit && (
            <Button variant="ghost" onClick={() => onEdit(asset)}>
              <Pencil size={13} />
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
