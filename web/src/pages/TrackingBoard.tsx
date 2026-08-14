/**
 * 追蹤看板
 *
 * 回答的問題：**東西現在卡在哪一站**。
 *
 * 每個階段一欄，卡片堆在自己的階段底下。
 * 哪一欄特別高，就是瓶頸在哪裡——這是表格永遠給不了的資訊。
 *
 * 手機用橫向捲動（POC 已驗證可行），不改成清單——
 * 改成清單就失去「哪一欄比較高」這個唯一的重點。
 */
import { Filter, Layers, Plus } from "lucide-react";
import { useMemo, useState } from "react";


import { useBoard, useOptions } from "@/api/hooks";
import { useCurrentUser } from "@/api/hooks/useAuth";
import type { BoardColumn, TrackingCard } from "@/api/types";
import UnitForm from "@/components/forms/UnitForm";
import TrackingCardView from "@/components/tracking/TrackingCard";
import UnitPanel from "@/components/tracking/UnitPanel";
import { Button, EmptyState, ErrorState, Select, Spinner } from "@/components/ui";
import { useStickyParams } from "@/lib/stickyParams";

const UNIT_TYPES = [
  { value: "batch", label: "構件批次（鋼構）" },
  { value: "work_item", label: "土建工項" },
];

// unit 不記——那是「從連結點進來要打開哪張卡」，不是篩選條件
const BOARD_KEYS = ["project", "unit_type", "status"];

export default function TrackingBoard() {
  const [searchParams, setSearchParams] = useStickyParams("board.filters", BOARD_KEYS);
  const { data: options } = useOptions();
  const { data: user } = useCurrentUser();
  const [selected, setSelected] = useState<TrackingCard | null>(null);
  const [creating, setCreating] = useState(false);

  const project = searchParams.get("project") ?? "";
  const status = searchParams.get("status") ?? "";

  // ★ 看板的欄位＝某一條流程的站。鋼構與土建的流程不一樣，
  // 「全部專案＋全部類型」畫不出一個有意義的看板——
  // 只能挑一條當主軌道，另一種全部擠進「其他流程」那一欄。
  //
  // 所以：沒選專案時，類型是必選（預設構件批次）。
  // 選了專案就可以選「全部類型」——混合案的兩種流程放在同一個案子裡看是合理的。
  const typeRequired = !project;
  const unitType = searchParams.get("unit_type") ?? (typeRequired ? "batch" : "");

  function setParam(name: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(name, value);
    else next.delete(name);
    setSearchParams(next, { replace: true });
  }

  const params = useMemo(
    () => ({
      project: project || undefined,
      unit_type: unitType || undefined,
      status: status || undefined,
    }),
    [project, unitType, status],
  );

  const { data, isLoading, error, refetch } = useBoard(params, Boolean(project || unitType));

  // 從「需要關注」或請款頁的連結過來時會帶 ?unit=，直接把那張卡打開。
  // 沒處理的話點過去只看到一整片看板，還要自己找那一批
  const deepLinkUnit = searchParams.get("unit");
  const [openedDeepLink, setOpenedDeepLink] = useState<string | null>(null);
  if (deepLinkUnit && openedDeepLink !== deepLinkUnit && data) {
    const found = data.boards
      .flatMap((b) => b.columns)
      .flatMap((c) => c.units)
      .find((u) => String(u.id) === deepLinkUnit);
    setOpenedDeepLink(deepLinkUnit);
    if (found) setSelected(found);
  }
  if (!deepLinkUnit && openedDeepLink !== null) setOpenedDeepLink(null);

  return (
    <div>
      {/* 篩選列：一排，不做展開式篩選面板（決策：UI 只留必要的） */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Filter size={15} className="text-ink-3" />
        <Select
          value={project}
          onChange={(v) => setParam("project", v)}
          options={(options?.projects ?? []).map((p) => ({ value: p.id, label: p.name }))}
          placeholder="全部專案"
        />
        <Select
          value={unitType}
          onChange={(v) => setParam("unit_type", v)}
          options={UNIT_TYPES}
          // 沒選專案時不給「全部類型」——給了會靜默跳回構件批次，
          // 使用者以為壞掉。不能選就不要顯示成可以選
          placeholder={typeRequired ? undefined : "全部類型（混合案）"}
        />
        <Select
          value={status}
          onChange={(v) => setParam("status", v)}
          options={options?.status ?? []}
          placeholder="全部狀態"
        />
        {data && (
          <span className="ml-auto text-xs text-ink-3">
            共 {data.total} 筆
            {data.truncated && (
              <span style={{ color: "var(--color-atrisk)" }}>（顯示前 {data.shown} 筆）</span>
            )}
          </span>
        )}
        {user?.permissions.edit_tracking && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={15} />
            新增
          </Button>
        )}
      </div>

      {typeRequired && (
        <p className="mb-3 text-[11px] leading-relaxed text-ink-3">
          看全部專案時必須指定類型——鋼構與土建走的流程不一樣，
          欄位不同，混在一起畫不出有意義的看板。
          <strong className="text-ink-2">選定一個專案</strong>後就可以看「全部類型」。
        </p>
      )}

      {data?.truncated_hint && (
        <p
          className="mb-3 rounded-lg px-3 py-2 text-xs"
          style={{ background: "var(--color-atrisk-bg)", color: "var(--color-atrisk)" }}
        >
          {data.truncated_hint}
        </p>
      )}

      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : !data ? (
        <EmptyState title="請先選擇專案或追蹤單元類型" />
      ) : data.total === 0 ? (
        <EmptyState
          title="這個範圍內沒有追蹤單元"
          hint={
            data.boards[0]
              ? `流程「${data.boards[0].template.name}」共 ${data.boards[0].columns.length} 站，目前沒有東西在跑`
              : undefined
          }
        />
      ) : (
        <>
          {/* 一條流程一個看板。混合案有兩條流程，就上下堆疊兩個——
              兩條流程站數不同，硬畫在同一排的話位置就沒有意義了 */}
          {data.boards.map((board) => (
            <section key={board.template.id} className="mb-4">
              {data.boards.length > 1 && (
                <h2 className="mb-1.5 text-xs font-bold text-ink-2">
                  {board.template.name}
                  <span className="ml-1.5 font-normal text-ink-3">
                    {board.count} 筆 · {board.columns.length} 站
                  </span>
                </h2>
              )}
              <div className="scroll-x -mx-4 px-4 pb-2">
                <div className="flex gap-3">
                  {board.columns.map((column) => (
                    <Column
                      key={column.stage.id}
                      column={column}
                      showProject={!project}
                      onOpen={setSelected}
                    />
                  ))}
                </div>
              </div>
            </section>
          ))}

          <Legend />
        </>
      )}

      <UnitPanel
        unit={selected}
        onClose={() => {
          setSelected(null);
          if (deepLinkUnit) setParam("unit", "");
        }}
      />
      <UnitForm
        open={creating}
        onClose={() => setCreating(false)}
        defaultProject={project ? Number(project) : undefined}
      />
    </div>
  );
}

function Column({
  column,
  showProject,
  onOpen,
}: {
  column: BoardColumn;
  showProject: boolean;
  onOpen: (unit: TrackingCard) => void;
}) {
  const stage = column.stage;
  return (
    <section className="flex w-[260px] shrink-0 flex-col rounded-xl bg-page/60 sm:w-[240px]">
      <header
        className="sticky top-0 flex items-center gap-1.5 rounded-t-xl px-3 py-2"
        style={{ background: stage.color }}
      >
        <h2 className="min-w-0 flex-1 truncate text-xs font-bold text-white">
          {stage.name}
        </h2>
        <span className="shrink-0 rounded-full bg-white/25 px-1.5 text-[11px] font-bold text-white tabular-nums">
          {column.count}
        </span>
      </header>

      <div className="flex flex-col gap-2 p-2">
        {column.units.length === 0 ? (
          <p className="py-6 text-center text-[11px] text-ink-3">—</p>
        ) : (
          column.units.map((unit) => (
            <TrackingCardView
              key={unit.id}
              unit={unit}
              onOpen={onOpen}
              showProject={showProject}
            />
          ))
        )}
      </div>
    </section>
  );
}

function Legend() {
  return (
    <p className="mt-3 flex items-center gap-1 text-[11px] text-ink-3">
      <Layers size={12} />
      欄位高度＝堆在那一站的數量，特別高的那一欄就是瓶頸
    </p>
  );
}
