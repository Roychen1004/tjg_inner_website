import React, { useState, useEffect, useMemo } from "react";
import {
  LayoutDashboard, FolderKanban, Boxes, Factory, Wallet, Plus, X,
  ChevronRight, ChevronLeft, ChevronDown, AlertTriangle, Clock, RefreshCw,
  Pencil, Trash2, Activity, Building2, Cpu, Cloud, Filter, Truck, Coins,
} from "lucide-react";

/* ════════ 設定 ════════ */
const KEY = "tiezheng_dashboard_v4";

// 專案主線（整案一條）
const PROJ_STAGES = [
  { k: "lead",     name: "接案",     color: "#6366f1" },
  { k: "design",   name: "深化設計", color: "#3b82f6" },
  { k: "quote",    name: "報價",     color: "#0ea5e9" },
  { k: "purchase", name: "採購備料", color: "#14b8a6" },
  { k: "build",    name: "施工中",   color: "#f59e0b" },
  { k: "verify",   name: "完工驗收", color: "#10b981" },
  { k: "close",    name: "結案",     color: "#64748b" },
];

// 構件批次（每批平行跑這條）
const BATCH_STAGES = [
  { k: "receive", name: "進料驗收", color: "#06b6d4" },
  { k: "fab",     name: "加工",     color: "#f59e0b", core: true },
  { k: "qc",      name: "品檢",     color: "#8b5cf6" },
  { k: "staging", name: "置料區",   color: "#0d9488", hold: true },
  { k: "surface", name: "表面處理", color: "#ef8c0b", vendor: true },
  { k: "deliver", name: "出貨進場", color: "#10b981", bill: true },
  { k: "install", name: "安裝",     color: "#22c55e" },
  { k: "finish",  name: "收尾",     color: "#64748b" },
];

const STATUS = {
  ontrack: { label: "正常", color: "#059669", bg: "#ecfdf5" },
  atrisk:  { label: "注意", color: "#d97706", bg: "#fffbeb" },
  delayed: { label: "延誤", color: "#dc2626", bg: "#fef2f2" },
};
const LINE_STATUS = {
  run:        { label: "運轉中", color: "#059669" },
  changeover: { label: "換線中", color: "#d97706" },
  repair:     { label: "維修",   color: "#dc2626" },
  idle:       { label: "閒置",   color: "#94a3b8" },
};
const BILL_STATE = {
  pending:   { label: "未到",   color: "#94a3b8", bg: "#f1f5f9" },
  claimable: { label: "可請款", color: "#d97706", bg: "#fffbeb" },
  invoiced:  { label: "已請款", color: "#2563eb", bg: "#eff6ff" },
  received:  { label: "已收款", color: "#059669", bg: "#ecfdf5" },
};
const BILL_ORDER = ["pending", "claimable", "invoiced", "received"];
const UNITS = ["支", "組", "噸", "片", "件"];

const now = () => Date.now();
const uid = (p) => p + Math.random().toString(36).slice(2, 8);
const money = (w) => (Number(w) >= 10000 ? `${(Number(w) / 10000).toFixed(2)} 億` : `${Number(w || 0).toLocaleString()} 萬`);
const relTime = (t) => {
  const d = (now() - t) / 1000;
  if (d < 60) return "剛剛";
  if (d < 3600) return `${Math.floor(d / 60)} 分鐘前`;
  if (d < 86400) return `${Math.floor(d / 3600)} 小時前`;
  return new Date(t).toLocaleDateString("zh-TW");
};
const overdue = (due) => due && new Date(due) < new Date(new Date().toDateString());

/* ════════ 種子資料 ════════ */
const P_GUYUE = uid("P"), P_CHANG = uid("P"), P_NAN = uid("P");
const SEED = {
  projects: [
    { id: P_GUYUE, name: "固越企業總部案", client: "固越企業", value: 8000, owner: "王志明", start: "2026-03-15", due: "2026-11-30", pstage: 4, status: "ontrack", note: "三期並行，第一期安裝中", contract: "工期：2026/03/15–11/30。請款：訂金30%／一期進場30%／二期進場30%／尾款10%。逾期罰則：每日合約額 0.1%。保固一年。", quoteInfo: "報價單 GY-2026-014：鋼構總重約 420 噸，含深化設計、加工、表面處理、運輸、安裝。", docs: "圖紙雲端：（貼上連結）｜結構技師：林技師 09xx-xxx" },
    { id: P_CHANG, name: "彰化食品廠房擴建", client: "統一食品", value: 3200, owner: "李建宏", start: "2026-02-15", due: "2026-07-20", pstage: 3, status: "atrisk", note: "鋼柱進料驗收中，需追料", contract: "工期：2026/02/15–07/20。請款：30/30/30/10。", quoteInfo: "報價單 TY-2026-008：約 180 噸。", docs: "" },
    { id: P_NAN,   name: "南投國道橋樑鋼構", client: "國工局", value: 5600, owner: "陳國華", start: "2025-11-01", due: "2026-09-15", pstage: 4, status: "ontrack", note: "桁架陸續出貨進場", contract: "公共工程合約。工期：2025/11–2026/09。需三級品管。", quoteInfo: "標案決標：約 310 噸桁架。", docs: "" },
  ],
  batches: [
    { id: uid("B"), pid: P_GUYUE, name: "第一期-1F鋼柱", qty: 80, done: 48, unit: "支", stage: 6, owner: "陳師傅", mode: "self", vendor: "", vin: "", vout: "", transport: "大發板車運輸", status: "ontrack", note: "工地組立中" },
    { id: uid("B"), pid: P_GUYUE, name: "第一期-樓板鋼樑", qty: 120, done: 90, unit: "支", stage: 4, owner: "黃師傅", mode: "outsource", vendor: "全興噴砂廠", vin: "2026-06-05", vout: "", transport: "", status: "ontrack", note: "送外廠噴砂+噴漆" },
    { id: uid("B"), pid: P_GUYUE, name: "第一期-樓梯鋼構", qty: 30, done: 30, unit: "組", stage: 3, owner: "陳師傅", mode: "self", vendor: "", vin: "", vout: "", transport: "大發板車運輸", status: "ontrack", note: "已加工完，置料區待運至現場" },
    { id: uid("B"), pid: P_GUYUE, name: "第二期-2F鋼柱", qty: 64, done: 20, unit: "支", stage: 1, owner: "張師傅", mode: "self", vendor: "", vin: "", vout: "", transport: "", status: "atrisk", note: "廠內二次加工線" },
    { id: uid("B"), pid: P_CHANG, name: "第一期-H型鋼柱", qty: 32, done: 0, unit: "支", stage: 0, owner: "張師傅", mode: "self", vendor: "", vin: "", vout: "", transport: "", status: "atrisk", note: "等鋼材到料" },
    { id: uid("B"), pid: P_NAN, name: "桁架 A 區", qty: 12, done: 12, unit: "組", stage: 5, owner: "黃師傅", mode: "self", vendor: "", vin: "", vout: "", transport: "宏運重車貨運", status: "ontrack", note: "已塗裝，運往現場" },
    { id: uid("B"), pid: P_NAN, name: "桁架 B 區", qty: 8, done: 5, unit: "組", stage: 2, owner: "陳師傅", mode: "self", vendor: "", vin: "", vout: "", transport: "", status: "ontrack", note: "品檢中" },
  ],
  billing: [
    { id: uid("M"), pid: P_GUYUE, label: "簽約訂金", trigger: "簽約", pct: 30, state: "received", inv: "2026-03-20", rec: "2026-04-02" },
    { id: uid("M"), pid: P_GUYUE, label: "第一期請款", trigger: "第一期構件進場", pct: 30, state: "invoiced", inv: "2026-06-08", rec: "" },
    { id: uid("M"), pid: P_GUYUE, label: "第二期請款", trigger: "第二期構件進場", pct: 30, state: "pending", inv: "", rec: "" },
    { id: uid("M"), pid: P_GUYUE, label: "完工尾款", trigger: "會同驗收完工", pct: 10, state: "pending", inv: "", rec: "" },
    { id: uid("M"), pid: P_CHANG, label: "簽約訂金", trigger: "簽約", pct: 30, state: "received", inv: "2026-02-20", rec: "2026-03-01" },
    { id: uid("M"), pid: P_CHANG, label: "第一期請款", trigger: "第一期構件進場", pct: 30, state: "pending", inv: "", rec: "" },
    { id: uid("M"), pid: P_CHANG, label: "第二期請款", trigger: "第二期構件進場", pct: 30, state: "pending", inv: "", rec: "" },
    { id: uid("M"), pid: P_CHANG, label: "完工尾款", trigger: "驗收完工", pct: 10, state: "pending", inv: "", rec: "" },
    { id: uid("M"), pid: P_NAN, label: "簽約訂金", trigger: "簽約", pct: 30, state: "received", inv: "2025-11-05", rec: "2025-11-20" },
    { id: uid("M"), pid: P_NAN, label: "第一期請款", trigger: "第一期構件進場", pct: 30, state: "received", inv: "2026-03-10", rec: "2026-03-28" },
    { id: uid("M"), pid: P_NAN, label: "第二期請款", trigger: "第二期構件進場", pct: 30, state: "invoiced", inv: "2026-06-01", rec: "" },
    { id: uid("M"), pid: P_NAN, label: "完工尾款", trigger: "驗收完工", pct: 10, state: "pending", inv: "", rec: "" },
  ],
  lines: [
    { id: uid("L"), name: "雷射切割線 (HSG TLS)", status: "run", wo: "固越-第二期", util: 78, out: "5.2 噸" },
    { id: uid("L"), name: "CNC 鑽孔線", status: "changeover", wo: "—", util: 62, out: "3.1 噸" },
    { id: uid("L"), name: "組裝焊接區", status: "run", wo: "固越-第二期", util: 71, out: "—" },
    { id: uid("L"), name: "塗裝線", status: "run", wo: "南投-A區", util: 85, out: "—" },
    { id: uid("L"), name: "品檢工作站", status: "idle", wo: "—", util: 45, out: "—" },
  ],
  activity: [
    { id: uid("A"), t: now() - 1000 * 60 * 6, text: "固越案·第一期樓板鋼樑 送往 全興噴砂廠 表面處理", type: "batch" },
    { id: uid("A"), t: now() - 1000 * 60 * 90, text: "南投案·第二期請款 標記為 已請款 (1,680 萬)", type: "bill" },
    { id: uid("A"), t: now() - 1000 * 60 * 200, text: "固越案·第二期 2F 鋼柱 進入 加工", type: "batch" },
  ],
  lastUpdated: now(),
};

/* 確保資料結構完整，避免缺少陣列導致錯誤 */
function normalize(d) {
  if (!d || !Array.isArray(d.projects)) return { ...SEED, lastUpdated: now() };
  return {
    projects: (Array.isArray(d.projects) ? d.projects : []).map((p) => ({ contract: "", quoteInfo: "", docs: "", note: "", ...p })),
    batches: (Array.isArray(d.batches) ? d.batches : []).map((b) => ({ done: 0, mode: "self", vendor: "", vin: "", vout: "", transport: "", note: "", ...b })),
    billing: Array.isArray(d.billing) ? d.billing : [],
    lines: Array.isArray(d.lines) ? d.lines : [],
    activity: Array.isArray(d.activity) ? d.activity : [],
    lastUpdated: d.lastUpdated || now(),
  };
}

/* ════════ 共用元件 ════════ */
function Badge({ s }) {
  const c = STATUS[s] || STATUS.ontrack;
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold" style={{ color: c.color, background: c.bg }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.color }} />{c.label}
    </span>
  );
}
function Bar({ pct, color }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: "#e2e8f0" }}>
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: color }} />
    </div>
  );
}
function ProjPipe({ idx }) {
  return (
    <div className="flex w-full items-center gap-0.5">
      {PROJ_STAGES.map((s, i) => {
        const done = i < idx, cur = i === idx;
        return (
          <div key={s.k} className="flex-1" title={s.name}>
            <div className="rounded-sm transition-all" style={{ height: cur ? 8 : 5, background: done || cur ? s.color : "#e2e8f0", opacity: done ? 0.5 : 1, boxShadow: cur ? `0 0 0 2px ${s.color}33` : "none" }} />
            <div className="mt-0.5 text-center text-[8px] leading-tight" style={{ color: cur ? s.color : "#cbd5e1", fontWeight: cur ? 700 : 400 }}>{s.name}</div>
          </div>
        );
      })}
    </div>
  );
}
function StageChip({ idx }) {
  const s = BATCH_STAGES[idx];
  return (
    <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold" style={{ color: s.color, background: `${s.color}1a` }}>
      {s.bill && <Coins size={10} />}{s.vendor && <Truck size={10} />}{s.name}
    </span>
  );
}
function Modal({ title, onClose, children, onDelete }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" style={{ background: "rgba(15,23,42,0.55)" }} onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold" style={{ color: "#0f172a" }}>{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1.5" style={{ color: "#64748b", background: "#f1f5f9" }}><X size={18} /></button>
        </div>
        {children}
        {onDelete && (
          <button onClick={onDelete} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold" style={{ color: "#dc2626", background: "#fef2f2" }}>
            <Trash2 size={15} /> 刪除
          </button>
        )}
      </div>
    </div>
  );
}
function Field({ label, children }) {
  return <label className="mb-3 block"><span className="mb-1 block text-xs font-semibold" style={{ color: "#475569" }}>{label}</span>{children}</label>;
}
function ConfirmDialog({ msg, label, onYes, onNo }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.6)", zIndex: 60 }} onClick={onNo}>
      <div className="w-full max-w-xs rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <p className="mb-4 text-sm leading-relaxed" style={{ color: "#0f172a" }}>{msg}</p>
        <div className="flex gap-2">
          <button onClick={onNo} className="flex-1 rounded-lg py-2.5 text-sm font-semibold" style={{ background: "#f1f5f9", color: "#475569" }}>取消</button>
          <button onClick={onYes} className="flex-1 rounded-lg py-2.5 text-sm font-bold text-white" style={{ background: "#dc2626" }}>{label || "確定"}</button>
        </div>
      </div>
    </div>
  );
}
const ic = "w-full rounded-lg border px-3 py-2 text-sm";
const is = { borderColor: "#cbd5e1", color: "#0f172a", background: "#fff" };

/* ════════ 主元件 ════════ */
export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("overview");
  const [edit, setEdit] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [batchFilter, setBatchFilter] = useState("all");
  const [confirmBox, setConfirmBox] = useState(null);
  const askConfirm = (msg, action, label) => setConfirmBox({ msg, action, label });
  const hasStorage = typeof window !== "undefined" && window.storage;

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  async function load() {
    setLoading(true);
    if (!hasStorage) { setData(normalize(SEED)); setLoading(false); return; }
    try {
      const r = await window.storage.get(KEY, true);
      if (r && r.value) setData(normalize(JSON.parse(r.value)));
      else { const s = normalize(SEED); setData(s); await window.storage.set(KEY, JSON.stringify(s), true); }
    } catch {
      const s = normalize(SEED); setData(s);
      try { await window.storage.set(KEY, JSON.stringify(s), true); } catch {}
    } finally { setLoading(false); }
  }
  async function save(next, log, type) {
    if (log) next.activity = [{ id: uid("A"), t: now(), text: log, type: type || "edit" }, ...(next.activity || [])].slice(0, 50);
    next.lastUpdated = now(); setData({ ...next });
    if (hasStorage) { try { await window.storage.set(KEY, JSON.stringify(next), true); } catch {} }
  }
  function reset() { askConfirm("確定重設為範例資料？目前資料將被覆蓋。", () => save({ ...SEED, lastUpdated: now() }, "儀表板已重設", "edit"), "確定重設"); }

  const pName = (id) => (data.projects.find((p) => p.id === id) || {}).name || "—";

  /* 專案 */
  const moveProj = (p, d) => {
    const ni = Math.max(0, Math.min(PROJ_STAGES.length - 1, p.pstage + d));
    if (ni === p.pstage) return;
    save({ ...data, projects: data.projects.map((x) => x.id === p.id ? { ...x, pstage: ni } : x) }, `「${p.name}」${d > 0 ? "推進至" : "退回至"} ${PROJ_STAGES[ni].name}`, "proj");
  };
  const saveProj = (it) => {
    const ex = data.projects.some((x) => x.id === it.id);
    save({ ...data, projects: ex ? data.projects.map((x) => x.id === it.id ? it : x) : [...data.projects, it] }, `${ex ? "更新" : "新增"}專案「${it.name}」`, "proj"); setEdit(null);
  };
  const delProj = (it) => askConfirm(`刪除專案「${it.name}」及其批次、請款資料？`, () => {
    save({ ...data, projects: data.projects.filter((x) => x.id !== it.id), batches: data.batches.filter((b) => b.pid !== it.id), billing: data.billing.filter((m) => m.pid !== it.id) }, `刪除專案「${it.name}」`, "proj"); setEdit(null);
  }, "確定刪除");

  /* 批次 */
  const moveBatch = (b, d) => {
    const ni = Math.max(0, Math.min(BATCH_STAGES.length - 1, b.stage + d));
    if (ni === b.stage) return;
    save({ ...data, batches: data.batches.map((x) => x.id === b.id ? { ...x, stage: ni } : x) }, `${pName(b.pid)}·${b.name} ${d > 0 ? "進入" : "退回"} ${BATCH_STAGES[ni].name}`, "batch");
  };
  const saveBatch = (it) => {
    const ex = data.batches.some((x) => x.id === it.id);
    save({ ...data, batches: ex ? data.batches.map((x) => x.id === it.id ? it : x) : [...data.batches, it] }, `${ex ? "更新" : "新增"}批次「${it.name}」`, "batch"); setEdit(null);
  };
  const delBatch = (it) => askConfirm(`刪除批次「${it.name}」？`, () => { save({ ...data, batches: data.batches.filter((x) => x.id !== it.id) }, `刪除批次「${it.name}」`, "batch"); setEdit(null); }, "確定刪除");

  /* 請款 */
  const cycleBill = (m) => {
    const ni = BILL_ORDER[(BILL_ORDER.indexOf(m.state) + 1) % BILL_ORDER.length];
    const patch = { state: ni };
    if (ni === "invoiced" && !m.inv) patch.inv = new Date().toISOString().slice(0, 10);
    if (ni === "received" && !m.rec) patch.rec = new Date().toISOString().slice(0, 10);
    const proj = data.projects.find((p) => p.id === m.pid);
    const amt = Math.round((proj?.value || 0) * m.pct / 100);
    save({ ...data, billing: data.billing.map((x) => x.id === m.id ? { ...x, ...patch } : x) }, `${pName(m.pid)}·${m.label} 標記為 ${BILL_STATE[ni].label} (${money(amt)})`, "bill");
  };
  const saveBill = (it) => {
    const ex = data.billing.some((x) => x.id === it.id);
    save({ ...data, billing: ex ? data.billing.map((x) => x.id === it.id ? it : x) : [...data.billing, it] }, `${ex ? "更新" : "新增"}請款里程碑「${it.label}」`, "bill"); setEdit(null);
  };
  const delBill = (it) => askConfirm(`刪除里程碑「${it.label}」？`, () => { save({ ...data, billing: data.billing.filter((x) => x.id !== it.id) }, `刪除里程碑「${it.label}」`, "bill"); setEdit(null); }, "確定刪除");

  /* 產線 */
  const saveLine = (it) => { const ex = data.lines.some((x) => x.id === it.id); save({ ...data, lines: ex ? data.lines.map((x) => x.id === it.id ? it : x) : [...data.lines, it] }, `${ex ? "更新" : "新增"}產線「${it.name}」`, "line"); setEdit(null); };
  const delLine = (it) => askConfirm(`刪除產線「${it.name}」？`, () => { save({ ...data, lines: data.lines.filter((x) => x.id !== it.id) }, `刪除產線「${it.name}」`, "line"); setEdit(null); }, "確定刪除");

  /* 財務計算 */
  const fin = useMemo(() => {
    if (!data) return null;
    const amtOf = (m) => { const p = (data.projects || []).find((x) => x.id === m.pid); return Math.round(((p && p.value) || 0) * m.pct / 100); };
    const total = (data.projects || []).reduce((s, p) => s + (Number(p.value) || 0), 0);
    let received = 0, billable = 0;
    (data.billing || []).forEach((m) => { const a = amtOf(m); if (m.state === "received") received += a; else if (m.state === "invoiced" || m.state === "claimable") billable += a; });
    return { total, received, billable, rate: total ? Math.round(received / total * 100) : 0, amtOf };
  }, [data]);

  const stats = useMemo(() => {
    if (!data) return null;
    const projs = data.projects || [], batches = data.batches || [], lines = data.lines || [];
    const active = projs.filter((p) => p.pstage < PROJ_STAGES.length - 1);
    const attention = [
      ...projs.filter((p) => p.status !== "ontrack").map((p) => ({ name: p.name, sub: PROJ_STAGES[p.pstage].name + "・" + (p.note || ""), status: p.status })),
      ...batches.filter((b) => b.status !== "ontrack").map((b) => ({ name: ((projs.find((p) => p.id === b.pid) || {}).name || "—") + "·" + b.name, sub: BATCH_STAGES[b.stage].name + "・" + (b.note || ""), status: b.status })),
    ];
    const perBatch = BATCH_STAGES.map((s, i) => ({ ...s, n: batches.filter((b) => b.stage === i).length }));
    const avgUtil = lines.length ? Math.round(lines.reduce((s, l) => s + (+l.util || 0), 0) / lines.length) : 0;
    return { active: active.length, attention, perBatch, maxB: Math.max(1, ...perBatch.map((s) => s.n)), avgUtil };
  }, [data]);

  if (loading || !data) return <div className="flex h-64 items-center justify-center" style={{ color: "#64748b" }}><RefreshCw className="mr-2 animate-spin" size={18} />載入中…</div>;

  const TABS = [
    { k: "overview", label: "總覽", icon: LayoutDashboard },
    { k: "projects", label: "專案", icon: FolderKanban },
    { k: "batches", label: "構件批次", icon: Boxes },
    { k: "finance", label: "請款/收款", icon: Wallet },
    { k: "lines", label: "產線", icon: Factory },
  ];
  const batchList = batchFilter === "all" ? data.batches : data.batches.filter((b) => b.pid === batchFilter);

  return (
    <div className="min-h-screen w-full" style={{ background: "#f1f5f9", fontFamily: "'Noto Sans TC',system-ui,sans-serif" }}>
      <div style={{ background: "linear-gradient(135deg,#1e293b,#334155)", borderBottom: "3px solid #f59e0b" }}>
        <div className="mx-auto max-w-6xl px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2"><Building2 size={20} style={{ color: "#f59e0b" }} /><h1 className="text-lg font-bold text-white sm:text-xl">鐵正綱工程 · 營運儀表板</h1></div>
              <p className="mt-0.5 text-xs" style={{ color: "#94a3b8" }}>構件批次平行追蹤 · 請款收攏 · 產線狀態</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="hidden items-center gap-1 rounded-full px-2.5 py-1 text-xs sm:inline-flex" style={{ color: "#bae6fd", background: "rgba(255,255,255,0.08)" }}><Cloud size={13} />{hasStorage ? "跨部門共用·自動保存" : "本機預覽"}</span>
              <button onClick={reset} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold" style={{ color: "#e2e8f0", background: "rgba(255,255,255,0.1)" }}><RefreshCw size={13} />重設</button>
            </div>
          </div>
          <div className="mt-3 flex gap-1 overflow-x-auto">
            {TABS.map((t) => { const on = tab === t.k; return (
              <button key={t.k} onClick={() => setTab(t.k)} className="flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold" style={{ color: on ? "#1e293b" : "#cbd5e1", background: on ? "#fff" : "transparent" }}><t.icon size={15} />{t.label}</button>
            ); })}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-5">
        <p className="mb-4 text-xs" style={{ color: "#94a3b8" }}>最後更新：{new Date(data.lastUpdated).toLocaleString("zh-TW")}</p>

        {tab === "overview" && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              {[
                { icon: FolderKanban, label: "進行中專案", val: stats.active, unit: "案", color: "#2563eb" },
                { icon: AlertTriangle, label: "需要關注", val: stats.attention.length, unit: "項", color: stats.attention.length ? "#dc2626" : "#059669" },
                { icon: Coins, label: "資金收攏率", val: fin.rate, unit: "%", color: fin.rate >= 60 ? "#059669" : fin.rate >= 40 ? "#d97706" : "#dc2626" },
                { icon: Wallet, label: "應收未收", val: money(fin.billable), unit: "", color: "#7c3aed" },
                { icon: Cpu, label: "平均稼動", val: stats.avgUtil, unit: "%", color: "#0891b2" },
              ].map((k, i) => (
                <div key={i} className="rounded-xl bg-white p-4 shadow-sm" style={{ border: "1px solid #e2e8f0" }}>
                  <div className="flex items-center gap-1.5" style={{ color: "#64748b" }}><k.icon size={14} /><span className="text-xs">{k.label}</span></div>
                  <div className="mt-1.5 font-bold" style={{ color: k.color, fontSize: 22 }}>{k.val}<span className="ml-0.5 text-sm font-medium">{k.unit}</span></div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
              <div className="rounded-xl bg-white p-4 shadow-sm lg:col-span-2" style={{ border: "1px solid #e2e8f0" }}>
                <h3 className="mb-3 flex items-center gap-1.5 text-sm font-bold" style={{ color: "#0f172a" }}><Wallet size={15} style={{ color: "#7c3aed" }} />各案收款進度</h3>
                <div className="space-y-3">
                  {data.projects.map((p) => {
                    const ms = data.billing.filter((m) => m.pid === p.id);
                    const rec = ms.filter((m) => m.state === "received").reduce((s, m) => s + fin.amtOf(m), 0);
                    const pct = p.value ? Math.round(rec / p.value * 100) : 0;
                    return (
                      <div key={p.id}>
                        <div className="mb-1 flex items-center justify-between text-xs"><span className="font-semibold" style={{ color: "#334155" }}>{p.name}</span><span style={{ color: "#64748b" }}>已收 {money(rec)} / {money(p.value)} · {pct}%</span></div>
                        <Bar pct={pct} color={pct >= 60 ? "#059669" : pct >= 30 ? "#d97706" : "#dc2626"} />
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="rounded-xl bg-white p-4 shadow-sm" style={{ border: "1px solid #e2e8f0" }}>
                <h3 className="mb-3 flex items-center gap-1.5 text-sm font-bold" style={{ color: "#0f172a" }}><AlertTriangle size={15} style={{ color: "#dc2626" }} />需要關注</h3>
                {stats.attention.length === 0 ? <p className="py-6 text-center text-xs" style={{ color: "#94a3b8" }}>一切正常 ✓</p> : (
                  <div className="space-y-2">
                    {stats.attention.slice(0, 6).map((a, i) => (
                      <div key={i} className="rounded-lg p-2" style={{ background: STATUS[a.status].bg }}>
                        <div className="flex items-center justify-between gap-1"><span className="text-xs font-semibold" style={{ color: "#0f172a" }}>{a.name}</span><Badge s={a.status} /></div>
                        <p className="mt-0.5 text-[11px]" style={{ color: "#64748b" }}>{a.sub}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
              <div className="rounded-xl bg-white p-4 shadow-sm lg:col-span-2" style={{ border: "1px solid #e2e8f0" }}>
                <h3 className="mb-3 text-sm font-bold" style={{ color: "#0f172a" }}>構件批次階段分布</h3>
                <div className="space-y-2">
                  {stats.perBatch.map((s) => (
                    <div key={s.k} className="flex items-center gap-2">
                      <span className="w-16 text-right text-xs" style={{ color: "#475569" }}>{s.name}</span>
                      <div className="h-5 flex-1 overflow-hidden rounded" style={{ background: "#f1f5f9" }}>
                        <div className="flex h-full items-center justify-end rounded px-2" style={{ width: `${(s.n / stats.maxB) * 100}%`, background: s.color, minWidth: s.n ? 24 : 0 }}>{s.n > 0 && <span className="text-xs font-bold text-white">{s.n}</span>}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl bg-white p-4 shadow-sm" style={{ border: "1px solid #e2e8f0" }}>
                <h3 className="mb-3 flex items-center gap-1.5 text-sm font-bold" style={{ color: "#0f172a" }}><Activity size={15} style={{ color: "#2563eb" }} />最近動態</h3>
                <div className="space-y-2.5">
                  {data.activity.slice(0, 7).map((a) => (
                    <div key={a.id} className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "#cbd5e1" }} /><div><p className="text-xs leading-snug" style={{ color: "#334155" }}>{a.text}</p><p className="text-[10px]" style={{ color: "#94a3b8" }}>{relTime(a.t)}</p></div></div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === "projects" && (
          <div>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs" style={{ color: "#64748b" }}>點專案展開構件批次 · 一案多批可同時在不同環節</p>
              <button onClick={() => setEdit({ type: "proj", item: { id: uid("P"), name: "", client: "", value: "", owner: "", start: "", due: "", pstage: 0, status: "ontrack", note: "" } })} className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-semibold text-white" style={{ background: "#2563eb" }}><Plus size={15} />新增專案</button>
            </div>
            <div className="space-y-3">
              {data.projects.map((p) => {
                const bs = data.batches.filter((b) => b.pid === p.id);
                const ms = data.billing.filter((m) => m.pid === p.id);
                const rec = ms.filter((m) => m.state === "received").reduce((s, m) => s + fin.amtOf(m), 0);
                const open = expanded[p.id];
                return (
                  <div key={p.id} className="rounded-xl bg-white shadow-sm" style={{ border: "1px solid #e2e8f0" }}>
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2"><span className="truncate text-sm font-bold" style={{ color: "#0f172a" }}>{p.name}</span><Badge s={p.status} /></div>
                          <p className="mt-0.5 text-xs" style={{ color: "#64748b" }}>{p.client} · 合約 {money(p.value)} · 負責 {p.owner || "—"}</p>
                        </div>
                        <button onClick={() => setEdit({ type: "proj", item: p })} style={{ color: "#cbd5e1" }}><Pencil size={14} /></button>
                      </div>
                      <div className="mt-3"><ProjPipe idx={p.pstage} /></div>
                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" style={{ color: "#64748b" }}>
                        <span className="flex items-center gap-1"><Boxes size={12} />{bs.length} 批構件</span>
                        <span className="flex items-center gap-1"><Coins size={12} />已收 {money(rec)} ({p.value ? Math.round(rec / p.value * 100) : 0}%)</span>
                        <span style={{ color: overdue(p.due) ? "#dc2626" : "#94a3b8" }}><Clock size={11} className="mr-0.5 inline" />{p.due || "—"}</span>
                      </div>
                      <div className="mt-3 flex gap-2">
                        <button onClick={() => moveProj(p, -1)} disabled={p.pstage === 0} className="rounded-md px-2 py-1 text-xs" style={{ background: "#f1f5f9", color: p.pstage === 0 ? "#cbd5e1" : "#475569" }}><ChevronLeft size={13} /></button>
                        <button onClick={() => moveProj(p, 1)} disabled={p.pstage === PROJ_STAGES.length - 1} className="flex items-center gap-0.5 rounded-md px-2 py-1 text-xs font-semibold text-white" style={{ background: p.pstage === PROJ_STAGES.length - 1 ? "#cbd5e1" : "#f59e0b" }}>推進主線<ChevronRight size={13} /></button>
                        <button onClick={() => setExpanded((e) => ({ ...e, [p.id]: !open }))} className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold" style={{ background: "#eff6ff", color: "#2563eb" }}><ChevronDown size={13} style={{ transform: open ? "rotate(180deg)" : "none" }} />{open ? "收合" : "展開批次"}</button>
                      </div>
                    </div>
                    {open && (
                      <div className="space-y-3 border-t px-4 py-3" style={{ borderColor: "#e2e8f0", background: "#f8fafc" }}>
                        {(p.contract || p.quoteInfo || p.docs) && (
                          <div className="rounded-lg bg-white p-3" style={{ border: "1px solid #e2e8f0" }}>
                            <p className="mb-1.5 flex items-center gap-1 text-xs font-bold" style={{ color: "#475569" }}><Building2 size={12} />專案基本資料</p>
                            {p.contract && <p className="mb-1 text-[11px] leading-relaxed" style={{ color: "#334155" }}><span className="font-semibold">合約：</span>{p.contract}</p>}
                            {p.quoteInfo && <p className="mb-1 text-[11px] leading-relaxed" style={{ color: "#334155" }}><span className="font-semibold">報價：</span>{p.quoteInfo}</p>}
                            {p.docs && <p className="text-[11px] leading-relaxed" style={{ color: "#334155" }}><span className="font-semibold">文件：</span>{p.docs}</p>}
                          </div>
                        )}
                        <div>
                          <div className="mb-2 flex items-center justify-between"><span className="text-xs font-bold" style={{ color: "#475569" }}>構件批次</span>
                            <button onClick={() => setEdit({ type: "batch", item: { id: uid("B"), pid: p.id, name: "", qty: "", done: "", unit: "支", stage: 0, owner: "", mode: "self", vendor: "", vin: "", vout: "", transport: "", status: "ontrack", note: "" } })} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-white" style={{ background: "#0891b2" }}><Plus size={12} />新增批次</button>
                          </div>
                          {bs.length === 0 ? <p className="py-3 text-center text-xs" style={{ color: "#94a3b8" }}>尚無批次</p> : (
                            <div className="space-y-2">
                              {bs.map((b) => { const bp = +b.qty > 0 ? Math.round((+b.done || 0) / +b.qty * 100) : 0; return (
                                <div key={b.id} className="rounded-lg bg-white p-2.5" style={{ border: "1px solid #e2e8f0" }}>
                                  <div className="flex items-start justify-between gap-2">
                                    <span className="truncate text-xs font-semibold" style={{ color: "#0f172a" }}>{b.name}</span>
                                    <button onClick={() => setEdit({ type: "batch", item: b })} style={{ color: "#cbd5e1" }}><Pencil size={13} /></button>
                                  </div>
                                  <div className="mt-1 flex items-center gap-2"><Bar pct={bp} color={bp >= 100 ? "#059669" : "#2563eb"} /><span className="shrink-0 text-[11px] font-semibold" style={{ color: "#475569" }}>{b.done || 0}/{b.qty || 0} {b.unit} · {bp}%</span></div>
                                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                    <StageChip idx={b.stage} />
                                    {b.mode === "outsource"
                                      ? <span className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: "#ffedd5", color: "#c2410c" }}><Truck size={9} className="mr-0.5 inline" />外包·{b.vendor || "未填"}</span>
                                      : <span className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: "#dbeafe", color: "#1d4ed8" }}>自行</span>}
                                    {b.transport && <span className="text-[10px]" style={{ color: "#0891b2" }}>運輸：{b.transport}</span>}
                                    <Badge s={b.status} />
                                  </div>
                                </div>
                              ); })}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tab === "batches" && (
          <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Filter size={14} style={{ color: "#64748b" }} />
                <select value={batchFilter} onChange={(e) => setBatchFilter(e.target.value)} className="rounded-lg border px-2 py-1.5 text-sm" style={is}>
                  <option value="all">全部專案</option>
                  {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <p className="text-xs" style={{ color: "#64748b" }}><Coins size={11} className="inline" /> 出貨進場可請款 · <Truck size={11} className="inline" /> 表面處理記外包</p>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {BATCH_STAGES.map((s, i) => {
                const items = batchList.filter((b) => b.stage === i);
                return (
                  <div key={s.k} className="shrink-0" style={{ width: 240 }}>
                    <div className="mb-2 flex items-center justify-between rounded-lg bg-white px-3 py-2" style={{ borderLeft: `4px solid ${s.color}`, border: "1px solid #e2e8f0" }}>
                      <span className="flex items-center gap-1 text-sm font-bold" style={{ color: "#0f172a" }}>{s.bill && <Coins size={12} style={{ color: s.color }} />}{s.vendor && <Truck size={12} style={{ color: s.color }} />}{s.name}</span>
                      <span className="rounded-full px-2 text-xs font-bold" style={{ color: s.color, background: `${s.color}1a` }}>{items.length}</span>
                    </div>
                    <div className="space-y-2">
                      {items.map((b) => { const bp = +b.qty > 0 ? Math.round((+b.done || 0) / +b.qty * 100) : 0; return (
                        <div key={b.id} className="rounded-xl bg-white p-3 shadow-sm" style={{ border: "1px solid #e2e8f0" }}>
                          <div className="flex items-start justify-between gap-1">
                            <button onClick={() => setEdit({ type: "batch", item: b })} className="text-left text-sm font-bold leading-snug" style={{ color: "#0f172a" }}>{b.name}</button>
                            <button onClick={() => setEdit({ type: "batch", item: b })} style={{ color: "#cbd5e1" }}><Pencil size={13} /></button>
                          </div>
                          <p className="mt-0.5 text-[11px]" style={{ color: "#94a3b8" }}>{pName(b.pid)}</p>
                          {/* 數量進度 */}
                          <div className="mt-1.5 flex items-center gap-2"><Bar pct={bp} color={bp >= 100 ? "#059669" : "#2563eb"} /><span className="shrink-0 text-[11px] font-semibold" style={{ color: "#475569" }}>{b.done || 0}/{b.qty || 0}{b.unit}</span></div>
                          {/* 作業方式 */}
                          <div className="mt-1.5">
                            {b.mode === "outsource"
                              ? <div className="rounded-md px-2 py-1 text-[11px]" style={{ background: "#fff7ed", color: "#c2410c" }}><Truck size={10} className="mr-0.5 inline" />外包·{b.vendor || "未填廠商"}{b.vin ? ` · 進 ${b.vin.slice(5)}` : ""}{b.vout ? ` · 出 ${b.vout.slice(5)}` : ""}</div>
                              : <span className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: "#dbeafe", color: "#1d4ed8" }}>鐵正綱自行</span>}
                          </div>
                          {b.transport && <p className="mt-1 text-[10px]" style={{ color: "#0891b2" }}><Truck size={9} className="mr-0.5 inline" />運輸：{b.transport}</p>}
                          <div className="mt-2 flex items-center justify-between"><Badge s={b.status} /><span className="text-[11px]" style={{ color: "#94a3b8" }}>{b.owner}</span></div>
                          <div className="mt-2 flex gap-1">
                            <button onClick={() => moveBatch(b, -1)} disabled={b.stage === 0} className="flex flex-1 items-center justify-center rounded-md py-1 text-xs" style={{ background: "#f1f5f9", color: b.stage === 0 ? "#cbd5e1" : "#475569" }}><ChevronLeft size={13} /></button>
                            <button onClick={() => moveBatch(b, 1)} disabled={b.stage === BATCH_STAGES.length - 1} className="flex flex-1 items-center justify-center gap-0.5 rounded-md py-1 text-xs font-semibold text-white" style={{ background: b.stage === BATCH_STAGES.length - 1 ? "#cbd5e1" : s.color }}>下一步<ChevronRight size={13} /></button>
                          </div>
                        </div>
                      ); })}
                      {items.length === 0 && <div className="rounded-lg border border-dashed py-4 text-center text-xs" style={{ borderColor: "#cbd5e1", color: "#cbd5e1" }}>—</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tab === "finance" && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[
                { label: "合約總額", val: money(fin.total), color: "#0f172a" },
                { label: "已收款", val: money(fin.received), color: "#059669" },
                { label: "應收未收", val: money(fin.billable), color: "#d97706" },
                { label: "資金收攏率", val: fin.rate + "%", color: fin.rate >= 60 ? "#059669" : fin.rate >= 40 ? "#d97706" : "#dc2626" },
              ].map((k, i) => (
                <div key={i} className="rounded-xl bg-white p-4 shadow-sm" style={{ border: "1px solid #e2e8f0" }}>
                  <p className="text-xs" style={{ color: "#64748b" }}>{k.label}</p>
                  <p className="mt-1 font-bold" style={{ color: k.color, fontSize: 22 }}>{k.val}</p>
                </div>
              ))}
            </div>
            <div className="rounded-xl bg-white p-4 shadow-sm" style={{ border: "1px solid #e2e8f0" }}>
              <p className="text-xs" style={{ color: "#475569" }}>整體收攏進度（已收 {money(fin.received)} / 合約 {money(fin.total)}）</p>
              <div className="mt-2 flex h-6 overflow-hidden rounded-lg" style={{ background: "#f1f5f9" }}>
                <div className="flex items-center justify-center text-xs font-bold text-white" style={{ width: `${fin.total ? fin.received / fin.total * 100 : 0}%`, background: "#059669" }}>{fin.rate}%</div>
                <div style={{ width: `${fin.total ? fin.billable / fin.total * 100 : 0}%`, background: "#fbbf24" }} title="應收未收" />
              </div>
              <p className="mt-1.5 text-[11px]" style={{ color: "#94a3b8" }}>綠＝已入帳 · 黃＝已請款/可請款待收 · 灰＝未到期</p>
            </div>

            {data.projects.map((p) => {
              const ms = data.billing.filter((m) => m.pid === p.id);
              return (
                <div key={p.id} className="rounded-xl bg-white p-4 shadow-sm" style={{ border: "1px solid #e2e8f0" }}>
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-sm font-bold" style={{ color: "#0f172a" }}>{p.name} <span className="text-xs font-normal" style={{ color: "#94a3b8" }}>· 合約 {money(p.value)}</span></span>
                    <button onClick={() => setEdit({ type: "bill", item: { id: uid("M"), pid: p.id, label: "", trigger: "", pct: "", state: "pending", inv: "", rec: "" } })} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-white" style={{ background: "#7c3aed" }}><Plus size={12} />里程碑</button>
                  </div>
                  <div className="space-y-2">
                    {ms.map((m) => {
                      const amt = fin.amtOf(m); const st = BILL_STATE[m.state];
                      return (
                        <div key={m.id} className="flex items-center gap-2 rounded-lg p-2.5" style={{ background: st.bg }}>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2"><span className="text-sm font-semibold" style={{ color: "#0f172a" }}>{m.label}</span><span className="text-xs font-bold" style={{ color: "#475569" }}>{m.pct}% · {money(amt)}</span></div>
                            <p className="text-[11px]" style={{ color: "#64748b" }}>觸發：{m.trigger || "—"}{m.inv ? ` · 請款 ${m.inv.slice(5)}` : ""}{m.rec ? ` · 收款 ${m.rec.slice(5)}` : ""}</p>
                          </div>
                          <button onClick={() => cycleBill(m)} className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ color: st.color, background: "#fff", border: `1.5px solid ${st.color}` }} title="點擊切換狀態">{st.label}</button>
                          <button onClick={() => setEdit({ type: "bill", item: m })} style={{ color: "#cbd5e1" }}><Pencil size={13} /></button>
                        </div>
                      );
                    })}
                    {ms.length === 0 && <p className="py-2 text-center text-xs" style={{ color: "#94a3b8" }}>尚未設定請款里程碑</p>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === "lines" && (
          <div>
            <div className="mb-3 flex justify-end"><button onClick={() => setEdit({ type: "line", item: { id: uid("L"), name: "", status: "idle", wo: "—", util: 0, out: "—" } })} className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-semibold text-white" style={{ background: "#2563eb" }}><Plus size={15} />新增產線</button></div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.lines.map((l) => (
                <div key={l.id} className="rounded-xl bg-white p-4 shadow-sm" style={{ border: "1px solid #e2e8f0", borderTop: `4px solid ${LINE_STATUS[l.status].color}` }}>
                  <div className="flex items-start justify-between"><span className="flex items-center gap-1.5 text-sm font-bold" style={{ color: "#0f172a" }}><Factory size={15} style={{ color: "#64748b" }} />{l.name}</span><button onClick={() => setEdit({ type: "line", item: l })} style={{ color: "#cbd5e1" }}><Pencil size={14} /></button></div>
                  <span className="mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold" style={{ color: LINE_STATUS[l.status].color, background: `${LINE_STATUS[l.status].color}1a` }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: LINE_STATUS[l.status].color }} />{LINE_STATUS[l.status].label}</span>
                  <div className="mt-3"><div className="mb-1 flex justify-between text-xs" style={{ color: "#64748b" }}><span>稼動率</span><span className="font-bold">{l.util}%</span></div><Bar pct={l.util} color={l.util >= 75 ? "#059669" : l.util >= 55 ? "#d97706" : "#dc2626"} /></div>
                  <div className="mt-3 flex justify-between text-xs" style={{ color: "#475569" }}><span>當前：{l.wo}</span><span>今日：{l.out}</span></div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {edit?.type === "proj" && <ProjForm item={edit.item} onClose={() => setEdit(null)} onSave={saveProj} onDelete={data.projects.some((x) => x.id === edit.item.id) ? () => delProj(edit.item) : null} />}
      {edit?.type === "batch" && <BatchForm item={edit.item} onClose={() => setEdit(null)} onSave={saveBatch} onDelete={data.batches.some((x) => x.id === edit.item.id) ? () => delBatch(edit.item) : null} />}
      {edit?.type === "bill" && <BillForm item={edit.item} value={(data.projects.find((p) => p.id === edit.item.pid) || {}).value} onClose={() => setEdit(null)} onSave={saveBill} onDelete={data.billing.some((x) => x.id === edit.item.id) ? () => delBill(edit.item) : null} />}
      {edit?.type === "line" && <LineForm item={edit.item} onClose={() => setEdit(null)} onSave={saveLine} onDelete={data.lines.some((x) => x.id === edit.item.id) ? () => delLine(edit.item) : null} />}
      {confirmBox && <ConfirmDialog msg={confirmBox.msg} label={confirmBox.label} onYes={() => { confirmBox.action(); setConfirmBox(null); }} onNo={() => setConfirmBox(null)} />}
    </div>
  );
}

/* ════════ 表單 ════════ */
function StatusPick({ v, on }) {
  return <div className="flex gap-2">{Object.entries(STATUS).map(([k, c]) => (
    <button key={k} onClick={() => on(k)} className="flex-1 rounded-lg py-2 text-sm font-semibold" style={{ background: v === k ? c.bg : "#f1f5f9", color: v === k ? c.color : "#94a3b8", border: v === k ? `1.5px solid ${c.color}` : "1.5px solid transparent" }}>{c.label}</button>
  ))}</div>;
}
function ProjForm({ item, onClose, onSave, onDelete }) {
  const [f, setF] = useState(item); const u = (k, v) => setF((p) => ({ ...p, [k]: v }));
  return (
    <Modal title={onDelete ? "編輯專案" : "新增專案"} onClose={onClose} onDelete={onDelete}>
      <Field label="案名"><input className={ic} style={is} value={f.name} onChange={(e) => u("name", e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-3"><Field label="客戶"><input className={ic} style={is} value={f.client} onChange={(e) => u("client", e.target.value)} /></Field><Field label="合約總額（萬）"><input type="number" className={ic} style={is} value={f.value} onChange={(e) => u("value", e.target.value)} /></Field></div>
      <div className="grid grid-cols-2 gap-3"><Field label="負責人"><input className={ic} style={is} value={f.owner} onChange={(e) => u("owner", e.target.value)} /></Field><Field label="主線環節"><select className={ic} style={is} value={f.pstage} onChange={(e) => u("pstage", +e.target.value)}>{PROJ_STAGES.map((s, i) => <option key={s.k} value={i}>{i + 1}.{s.name}</option>)}</select></Field></div>
      <div className="grid grid-cols-2 gap-3"><Field label="開工日"><input type="date" className={ic} style={is} value={f.start} onChange={(e) => u("start", e.target.value)} /></Field><Field label="預計完工"><input type="date" className={ic} style={is} value={f.due} onChange={(e) => u("due", e.target.value)} /></Field></div>
      <Field label="狀態"><StatusPick v={f.status} on={(v) => u("status", v)} /></Field>
      <Field label="備註"><textarea className={ic} style={is} rows={2} value={f.note} onChange={(e) => u("note", e.target.value)} /></Field>
      {/* 專案基本資料 / 文件 */}
      <div className="mb-3 rounded-lg p-3" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
        <p className="mb-2 flex items-center gap-1 text-xs font-bold" style={{ color: "#475569" }}><Building2 size={12} />專案基本資料 / 文件</p>
        <label className="mb-2 block text-[11px]" style={{ color: "#475569" }}>合約內容（工期、請款條件、罰則、保固…）<textarea className={ic} style={is} rows={3} value={f.contract} onChange={(e) => u("contract", e.target.value)} /></label>
        <label className="mb-2 block text-[11px]" style={{ color: "#475569" }}>報價單資訊<textarea className={ic} style={is} rows={2} value={f.quoteInfo} onChange={(e) => u("quoteInfo", e.target.value)} /></label>
        <label className="block text-[11px]" style={{ color: "#475569" }}>其他文件 / 連結（圖紙雲端連結、聯絡窗口…）<textarea className={ic} style={is} rows={2} value={f.docs} onChange={(e) => u("docs", e.target.value)} /></label>
        <p className="mt-1.5 text-[10px]" style={{ color: "#94a3b8" }}>※ 目前可貼文字與連結；實體檔案（PDF 合約/圖）待雲端整合階段再支援上傳</p>
      </div>
      <button onClick={() => f.name.trim() && onSave(f)} className="w-full rounded-lg py-2.5 text-sm font-bold text-white" style={{ background: "#2563eb" }}>儲存</button>
    </Modal>
  );
}
function BatchForm({ item, onClose, onSave, onDelete }) {
  const [f, setF] = useState(item); const u = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const out = f.mode === "outsource";
  const pct = +f.qty > 0 ? Math.round((+f.done || 0) / +f.qty * 100) : 0;
  return (
    <Modal title={onDelete ? "編輯構件批次" : "新增構件批次"} onClose={onClose} onDelete={onDelete}>
      <Field label="批次名稱（如 第一期-A區鋼柱）"><input className={ic} style={is} value={f.name} onChange={(e) => u("name", e.target.value)} /></Field>
      {/* 數量進度 */}
      <div className="mb-3 rounded-lg p-3" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
        <div className="grid grid-cols-3 gap-2">
          <label className="text-[11px]" style={{ color: "#475569" }}>目前數量<input type="number" className={ic} style={is} value={f.done} onChange={(e) => u("done", e.target.value)} /></label>
          <label className="text-[11px]" style={{ color: "#475569" }}>總數量<input type="number" className={ic} style={is} value={f.qty} onChange={(e) => u("qty", e.target.value)} /></label>
          <label className="text-[11px]" style={{ color: "#475569" }}>單位<select className={ic} style={is} value={f.unit} onChange={(e) => u("unit", e.target.value)}>{UNITS.map((x) => <option key={x}>{x}</option>)}</select></label>
        </div>
        <div className="mt-2 flex items-center gap-2"><Bar pct={pct} color={pct >= 100 ? "#059669" : "#2563eb"} /><span className="text-xs font-bold" style={{ color: "#475569" }}>{pct}%</span></div>
        <p className="mt-1 text-[11px]" style={{ color: "#94a3b8" }}>完成 {f.done || 0} / {f.qty || 0} {f.unit}</p>
      </div>
      <div className="grid grid-cols-2 gap-3"><Field label="目前環節"><select className={ic} style={is} value={f.stage} onChange={(e) => u("stage", +e.target.value)}>{BATCH_STAGES.map((s, i) => <option key={s.k} value={i}>{i + 1}.{s.name}</option>)}</select></Field><Field label="負責人"><input className={ic} style={is} value={f.owner} onChange={(e) => u("owner", e.target.value)} /></Field></div>
      {/* 作業方式：自行 / 外包協力廠 */}
      <div className="mb-3 rounded-lg p-3" style={{ background: out ? "#fff7ed" : "#f8fafc", border: `1px solid ${out ? "#fed7aa" : "#e2e8f0"}` }}>
        <p className="mb-2 text-xs font-bold" style={{ color: "#475569" }}>本環節作業方式</p>
        <div className="mb-2 flex gap-2">
          <button onClick={() => u("mode", "self")} className="flex-1 rounded-lg py-2 text-sm font-semibold" style={{ background: !out ? "#dbeafe" : "#f1f5f9", color: !out ? "#1d4ed8" : "#94a3b8", border: !out ? "1.5px solid #2563eb" : "1.5px solid transparent" }}>鐵正綱自行</button>
          <button onClick={() => u("mode", "outsource")} className="flex-1 rounded-lg py-2 text-sm font-semibold" style={{ background: out ? "#ffedd5" : "#f1f5f9", color: out ? "#c2410c" : "#94a3b8", border: out ? "1.5px solid #ea580c" : "1.5px solid transparent" }}>外包協力廠</button>
        </div>
        {out && (
          <div>
            <input className={ic + " mb-2"} style={is} placeholder="協力廠名稱（如 全興噴砂廠）" value={f.vendor} onChange={(e) => u("vendor", e.target.value)} />
            <div className="grid grid-cols-2 gap-2"><label className="text-[11px]" style={{ color: "#9a3412" }}>進廠日<input type="date" className={ic} style={is} value={f.vin} onChange={(e) => u("vin", e.target.value)} /></label><label className="text-[11px]" style={{ color: "#9a3412" }}>出廠日<input type="date" className={ic} style={is} value={f.vout} onChange={(e) => u("vout", e.target.value)} /></label></div>
          </div>
        )}
      </div>
      {/* 運輸廠商 */}
      <Field label="運輸廠商（板車/貨運，出貨進場用）"><input className={ic} style={is} placeholder="如 大發板車運輸" value={f.transport} onChange={(e) => u("transport", e.target.value)} /></Field>
      <Field label="狀態"><StatusPick v={f.status} on={(v) => u("status", v)} /></Field>
      <Field label="備註"><input className={ic} style={is} value={f.note} onChange={(e) => u("note", e.target.value)} /></Field>
      <button onClick={() => f.name.trim() && onSave(f)} className="w-full rounded-lg py-2.5 text-sm font-bold text-white" style={{ background: "#0891b2" }}>儲存</button>
    </Modal>
  );
}
function BillForm({ item, value, onClose, onSave, onDelete }) {
  const [f, setF] = useState(item); const u = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const amt = Math.round((+value || 0) * (+f.pct || 0) / 100);
  return (
    <Modal title={onDelete ? "編輯請款里程碑" : "新增請款里程碑"} onClose={onClose} onDelete={onDelete}>
      <Field label="里程碑名稱（如 第一期請款）"><input className={ic} style={is} value={f.label} onChange={(e) => u("label", e.target.value)} /></Field>
      <Field label="觸發條件（如 第一期構件進場）"><input className={ic} style={is} value={f.trigger} onChange={(e) => u("trigger", e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-3"><Field label="比例（%）"><input type="number" className={ic} style={is} value={f.pct} onChange={(e) => u("pct", e.target.value)} /></Field><Field label="金額（自動）"><div className="rounded-lg px-3 py-2 text-sm font-bold" style={{ background: "#f1f5f9", color: "#0f172a" }}>{money(amt)}</div></Field></div>
      <Field label="狀態"><div className="grid grid-cols-2 gap-2">{BILL_ORDER.map((k) => { const c = BILL_STATE[k]; return <button key={k} onClick={() => u("state", k)} className="rounded-lg py-2 text-sm font-semibold" style={{ background: f.state === k ? c.bg : "#f1f5f9", color: f.state === k ? c.color : "#94a3b8", border: f.state === k ? `1.5px solid ${c.color}` : "1.5px solid transparent" }}>{c.label}</button>; })}</div></Field>
      <div className="grid grid-cols-2 gap-3"><Field label="請款日"><input type="date" className={ic} style={is} value={f.inv} onChange={(e) => u("inv", e.target.value)} /></Field><Field label="收款日"><input type="date" className={ic} style={is} value={f.rec} onChange={(e) => u("rec", e.target.value)} /></Field></div>
      <button onClick={() => f.label.trim() && onSave(f)} className="w-full rounded-lg py-2.5 text-sm font-bold text-white" style={{ background: "#7c3aed" }}>儲存</button>
    </Modal>
  );
}
function LineForm({ item, onClose, onSave, onDelete }) {
  const [f, setF] = useState(item); const u = (k, v) => setF((p) => ({ ...p, [k]: v }));
  return (
    <Modal title={onDelete ? "編輯產線" : "新增產線"} onClose={onClose} onDelete={onDelete}>
      <Field label="產線名稱"><input className={ic} style={is} value={f.name} onChange={(e) => u("name", e.target.value)} /></Field>
      <Field label="狀態"><div className="grid grid-cols-2 gap-2">{Object.entries(LINE_STATUS).map(([k, c]) => <button key={k} onClick={() => u("status", k)} className="flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold" style={{ background: f.status === k ? `${c.color}1a` : "#f1f5f9", color: f.status === k ? c.color : "#94a3b8", border: f.status === k ? `1.5px solid ${c.color}` : "1.5px solid transparent" }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: c.color }} />{c.label}</button>)}</div></Field>
      <div className="grid grid-cols-2 gap-3"><Field label="當前工單/批次"><input className={ic} style={is} value={f.wo} onChange={(e) => u("wo", e.target.value)} /></Field><Field label="稼動率（%）"><input type="number" className={ic} style={is} value={f.util} onChange={(e) => u("util", +e.target.value)} /></Field></div>
      <Field label="今日產出"><input className={ic} style={is} value={f.out} onChange={(e) => u("out", e.target.value)} /></Field>
      <button onClick={() => f.name.trim() && onSave(f)} className="w-full rounded-lg py-2.5 text-sm font-bold text-white" style={{ background: "#2563eb" }}>儲存</button>
    </Modal>
  );
}
