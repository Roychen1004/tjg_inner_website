/**
 * 行政事項的新增／修改表單（D53）
 *
 * 一個彈窗做兩件事，用最上面的「臨時／例行」切換：
 *   臨時　一次性的事，填一個日期
 *   例行　每週／每月／每年，存完系統自動長出每一次
 * 已建立的東西不換型態——改臨時事項就是改那一筆，改例行就是改整條規則。
 *
 * D55：可以填金額。填了就會出現在「金流 → 收支明細」與現金流預測裡
 * （網路費、清潔費這些也是公司的錢）；留 0 就只是一件待辦。
 *
 * D56 兩件事：
 *   · 類別下拉裡直接新增類別（要跟哪家公司開會，臨時就開一個「開會」類別），
 *     不用先關掉表單跑去「類別」那頁
 *   · 金額除了收入／支出，還有第三個「參考」＝預估的錢，只顯示不進金流
 */
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { ApiError } from "@/api/client";
import {
  useAffairCategories,
  useDeleteAffairRule,
  useDeleteAffairTask,
  useOptions,
  useSaveAffairCategory,
  useSaveAffairRule,
  useSaveAffairTask,
} from "@/api/hooks";
import type { AffairRule, AffairTask } from "@/api/types";
import {
  Button,
  DateInput,
  Field,
  Modal,
  Segmented,
  Select,
  inputClass,
} from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { PALETTE } from "@/components/affairs/CategoryManager";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
/** 類別下拉裡那個「＋ 新增類別」的假值——真的類別 id 都是數字，不會撞到 */
const NEW_CATEGORY = "__new__";

export default function AffairTaskForm({
  open,
  onClose,
  task,
  rule,
  defaultDate,
}: {
  open: boolean;
  onClose: () => void;
  /** 修改某一筆待辦 */
  task?: AffairTask | null;
  /** 修改整條例行規則 */
  rule?: AffairRule | null;
  /** 新增時預帶的日期（點日曆的空白格） */
  defaultDate?: string;
}) {
  const editing = Boolean(task || rule);
  const categories = useAffairCategories();
  const options = useOptions();
  const saveCategory = useSaveAffairCategory();
  const saveTask = useSaveAffairTask();
  const saveRule = useSaveAffairRule();
  const delTask = useDeleteAffairTask();
  const delRule = useDeleteAffairRule();
  const toast = useToast();

  const today = new Date().toISOString().slice(0, 10);
  const [kind, setKind] = useState<"once" | "repeat">(rule ? "repeat" : "once");
  const [title, setTitle] = useState(task?.title ?? rule?.title ?? "");
  const [category, setCategory] = useState(
    String(task?.category ?? rule?.category ?? ""),
  );
  const [note, setNote] = useState(task?.note ?? rule?.note ?? "");
  // D55：金額。0 或空白＝純待辦，不進金流
  const [amount, setAmount] = useState(() => {
    const raw = Number(task?.amount ?? rule?.amount ?? 0);
    return raw ? String(raw) : "";
  });
  const [direction, setDirection] = useState(task?.direction ?? rule?.direction ?? "out");
  // D56：只是參考＝預估的錢，畫面上看得到但不進金流
  const [isReference, setIsReference] = useState(
    task?.is_reference ?? rule?.is_reference ?? false,
  );
  // D56：在這裡直接開新類別（空字串＝沒在新增）
  const [newCategory, setNewCategory] = useState<string | null>(null);
  const [date, setDate] = useState(task?.date ?? defaultDate ?? today);
  const [assignees, setAssignees] = useState<number[]>(
    task?.assignees ?? rule?.assignees ?? [],
  );
  const [freq, setFreq] = useState<string>(rule?.freq ?? "weekly");
  const [weekdays, setWeekdays] = useState<number[]>(rule?.weekdays ?? []);
  const [monthDay, setMonthDay] = useState(String(rule?.month_day ?? 5));
  const [yearMonth, setYearMonth] = useState(String(rule?.year_month ?? 1));
  const [yearDay, setYearDay] = useState(String(rule?.year_day ?? 1));
  const [startDate, setStartDate] = useState(rule?.start_date ?? defaultDate ?? today);
  const [endDate, setEndDate] = useState(rule?.end_date ?? "");
  const [error, setError] = useState("");

  const users = options.data?.users ?? [];
  const cats = categories.data ?? [];
  // 類別沒選就用第一個——三個預設類別一定在，不讓使用者卡在空下拉
  const categoryId = Number(category || cats[0]?.id || 0);
  const pending = saveTask.isPending || saveRule.isPending;

  function toggleAssignee(id: number) {
    setAssignees((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  /** 類別下拉選到「＋ 新增類別」就地開一個，不用關掉表單跑去別頁（D56） */
  function createCategory() {
    const name = (newCategory ?? "").trim();
    if (!name) return setError("請填新類別的名稱，如「開會」");
    setError("");
    saveCategory.mutate(
      // 顏色照類別數量往下輪，跟「類別」那頁同一組色；不滿意再去那頁改
      { name, color: PALETTE[cats.length % PALETTE.length] },
      {
        onSuccess: (created) => {
          setCategory(String(created.id));
          setNewCategory(null);
          toast.success(`已新增類別「${created.name}」`);
        },
        // 重名要看到的是「已經有這個類別了，直接在下拉選它」，
        // 不是 detail 那句罐頭的「資料驗證失敗」
        onError: (e) =>
          setError(
            e instanceof ApiError
              ? e.fieldError("name") ?? e.body.detail ?? "新增類別失敗"
              : "新增類別失敗",
          ),
      },
    );
  }

  function fail(e: unknown) {
    if (!(e instanceof ApiError)) return setError("儲存失敗");
    // 欄位級的訊息才講得出哪裡不對；body.detail 只會說「資料驗證失敗」
    const messages = e.otherErrors();
    setError(messages.length ? messages.join("；") : e.body.detail ?? "儲存失敗");
  }

  function submit() {
    setError("");
    if (!title.trim()) return setError("請填事項標題");
    if (!categoryId) return setError("請先建立一個類別");
    if (newCategory !== null) return setError("新類別還沒建立——按「建立」或「取消」");
    // 沒填金額就不會有「參考」這回事，別把旗標留在資料裡誤導後面的人
    const reference = isReference && Number(amount || 0) > 0;

    if (kind === "once") {
      saveTask.mutate(
        {
          id: task?.id, title: title.trim(), category: categoryId, date, note, assignees,
          amount: amount.trim() || "0", direction, is_reference: reference,
        },
        {
          onSuccess: () => {
            toast.success(task ? "已更新" : "已新增行政事項");
            onClose();
          },
          onError: fail,
        },
      );
      return;
    }

    const body: Record<string, unknown> = {
      title: title.trim(),
      category: categoryId,
      note,
      amount: amount.trim() || "0",
      direction,
      is_reference: reference,
      freq,
      start_date: startDate,
      end_date: endDate || null,
      assignees,
      weekdays: freq === "weekly" ? weekdays : [],
      month_day: freq === "monthly" ? Number(monthDay) : null,
      year_month: freq === "yearly" ? Number(yearMonth) : null,
      year_day: freq === "yearly" ? Number(yearDay) : null,
    };
    saveRule.mutate(
      { id: rule?.id, ...body },
      {
        onSuccess: () => {
          toast.success(rule ? "已更新例行事項" : "已新增例行事項", [
            "系統已把每一次排進日曆",
          ]);
          onClose();
        },
        onError: fail,
      },
    );
  }

  function remove() {
    if (task) {
      delTask.mutate(task.id, {
        onSuccess: () => {
          toast.success("已刪除這一次");
          onClose();
        },
        onError: fail,
      });
    } else if (rule) {
      delRule.mutate(rule.id, {
        onSuccess: () => {
          toast.success("已刪除例行事項", ["未來還沒做的一起收走，做過的留著"]);
          onClose();
        },
        onError: fail,
      });
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        rule ? "修改例行事項" : task ? "修改行政事項" : "新增行政事項"
      }
      footer={
        <>
          {editing && (
            <Button variant="ghost" onClick={remove} loading={delTask.isPending || delRule.isPending}>
              <Trash2 size={14} />
              刪除
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} className="ml-auto">
            取消
          </Button>
          <Button variant="primary" onClick={submit} loading={pending}>
            儲存
          </Button>
        </>
      }
    >
      {!editing && (
        <Field label="型態">
          <Segmented
            value={kind}
            onChange={(v) => setKind(v as "once" | "repeat")}
            grow
            options={[
              { value: "once", label: "臨時（一次）" },
              { value: "repeat", label: "例行（重複）" },
            ]}
          />
        </Field>
      )}

      <Field label="事項" required>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="如：繳公司網路費"
          className={inputClass}
        />
      </Field>

      {/* D56：類別不夠用就在這裡開一個——要跟哪家公司開會、臨時的專案外雜務，
          不用先關掉表單跑去「類別」那頁再回來重填 */}
      <Field
        label="類別"
        required
        hint={
          newCategory === null
            ? "下拉最後一項可以直接開新類別，例如要開會就先建一個「開會」"
            : "建立完會直接選起來；顏色系統先配一個，要改到工具列的「類別」改"
        }
      >
        {newCategory === null ? (
          <Select
            value={String(categoryId || "")}
            onChange={(v) => (v === NEW_CATEGORY ? setNewCategory("") : setCategory(v))}
            options={[
              ...cats.map((c) => ({ value: c.id, label: c.name })),
              { value: NEW_CATEGORY, label: "＋ 新增類別…" },
            ]}
            className="w-full"
          />
        ) : (
          <div className="flex gap-2">
            <input
              autoFocus
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  createCategory();
                } else if (e.key === "Escape") {
                  setNewCategory(null);
                }
              }}
              placeholder="新類別，如「開會」"
              className={`${inputClass} flex-1`}
            />
            <Button variant="primary" onClick={createCategory} loading={saveCategory.isPending}>
              <Plus size={14} />
              建立
            </Button>
            <Button variant="ghost" onClick={() => setNewCategory(null)}>
              取消
            </Button>
          </div>
        )}
      </Field>

      {kind === "once" ? (
        <Field label="日期" required>
          <DateInput value={date} onChange={setDate} />
        </Field>
      ) : (
        <>
          <Field label="重複" required>
            <Segmented
              value={freq}
              onChange={setFreq}
              grow
              options={[
                { value: "weekly", label: "每週" },
                { value: "monthly", label: "每月" },
                { value: "yearly", label: "每年" },
              ]}
            />
          </Field>

          {freq === "weekly" && (
            <Field label="星期幾" required hint="可複選">
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((label, idx) => {
                  const on = weekdays.includes(idx);
                  return (
                    <button
                      key={label}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setWeekdays((prev) =>
                          on ? prev.filter((d) => d !== idx) : [...prev, idx],
                        )
                      }
                      className={[
                        "h-10 w-10 rounded-lg border text-sm font-semibold transition-base",
                        on
                          ? "border-stage-2 bg-stage-2 text-white"
                          : "border-line bg-card text-ink-2 hover:bg-page",
                      ].join(" ")}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </Field>
          )}

          {freq === "monthly" && (
            <Field label="每月幾日" required hint="填 31 的話，小月自動算到月底">
              <input
                type="number"
                min={1}
                max={31}
                value={monthDay}
                onChange={(e) => setMonthDay(e.target.value)}
                className={inputClass}
              />
            </Field>
          )}

          {freq === "yearly" && (
            <div className="flex gap-2">
              <Field label="月" required>
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={yearMonth}
                  onChange={(e) => setYearMonth(e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="日" required>
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={yearDay}
                  onChange={(e) => setYearDay(e.target.value)}
                  className={inputClass}
                />
              </Field>
            </div>
          )}

          <div className="flex gap-2">
            <Field label="從哪天開始" required>
              <DateInput value={startDate} onChange={setStartDate} />
            </Field>
            <Field label="到哪天結束" hint="不填＝一直重複">
              <DateInput value={endDate} onChange={setEndDate} placeholder="不限" />
            </Field>
          </div>
        </>
      )}

      <Field
        label="指派給"
        hint={
          kind === "repeat"
            ? "每一次都會出現在他們的「我的任務」；可不指派"
            : "可多人，任一人勾完成即整件完成；可不指派"
        }
      >
        <div className="flex flex-wrap gap-1.5">
          {users.map((u) => {
            const on = assignees.includes(u.id);
            return (
              <button
                key={u.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggleAssignee(u.id)}
                className={[
                  "rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-base",
                  on
                    ? "border-stage-2 bg-stage-2 text-white"
                    : "border-line bg-card text-ink-2 hover:bg-page",
                ].join(" ")}
              >
                {u.name}
              </button>
            );
          })}
        </div>
      </Field>

      {/* D55：金額。多數行政事項是支出（繳費），所以預設「支出」
          D56：第三個「參考」＝還沒談定的預估，只在這件事上顯示，不進金流 */}
      <Field
        label="金額"
        hint={
          isReference
            ? "「參考」只顯示在這件事上，不會算進金流的收入與支出——談定了再改回支出或收入"
            : kind === "repeat"
              ? "每一次的金額，長出來的每一筆都帶著它；不涉及錢就留空"
              : "填了就會進「金流 → 收支明細」與現金流預測；不涉及錢就留空"
        }
      >
        <div className="flex flex-wrap gap-2">
          <input
            type="number"
            min={0}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="不涉及金錢就留空"
            className={`${inputClass} min-w-32 flex-1`}
          />
          <Segmented
            value={isReference ? "ref" : direction}
            onChange={(v) => {
              setIsReference(v === "ref");
              // 切回收入／支出時記住方向；再切成參考也不會忘記原本是哪一邊
              if (v !== "ref") setDirection(v as "in" | "out");
            }}
            options={[
              { value: "out", label: "支出" },
              { value: "in", label: "收入" },
              { value: "ref", label: "參考" },
            ]}
          />
        </div>
      </Field>

      <Field label="備註">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="如：上網銀繳，帳號在保險箱資料夾"
          className={inputClass}
        />
      </Field>

      {error && (
        <p className="text-sm font-semibold" style={{ color: "var(--color-delayed)" }}>
          {error}
        </p>
      )}
    </Modal>
  );
}
