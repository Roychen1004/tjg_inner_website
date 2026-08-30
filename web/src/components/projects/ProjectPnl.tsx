/**
 * 專案損益
 *
 * 有了應付，「這個案子賺不賺」就只是同一份資料換個角度看。
 *
 * 兩個口徑一起給，因為只給一個都會誤導：
 *   已計價  —— 只算包商已經送單的。案子前期會**太樂觀**（成本還沒發生）
 *   已簽約  —— 算進所有簽了的合約。這才是真正承諾出去的錢
 *
 * 預設顯示「已簽約」——高估成本比低估安全。
 */
import { useState } from "react";

import { useProjectPnl } from "@/api/hooks";
import type { ProjectDetail } from "@/api/types";
import { Card, Money, ProgressBar, SectionTitle, Segmented } from "@/components/ui";

export default function ProjectPnl({ project }: { project: ProjectDetail }) {
  const { data, isError } = useProjectPnl(project.id);
  const [basis, setBasis] = useState<"committed" | "billed">("committed");

  // 沒有金額權限時後端回 403，這一區直接不出現
  if (isError || !data) return null;

  const view = data[basis];
  const revenue = Number(data.revenue);
  const gross = Number(view.gross);
  const pct = view.pct ?? 0;

  return (
    <div className="mt-4">
      <SectionTitle
        action={
          <Segmented
            value={basis}
            onChange={(v) => setBasis(v as typeof basis)}
            options={[
              { value: "committed", label: "已簽約" },
              { value: "billed", label: "已計價" },
            ]}
          />
        }
      >
        專案損益
      </SectionTitle>

      <Card className="p-3">
        <dl className="grid grid-cols-3 gap-3 text-xs">
          <div>
            <dt className="text-ink-3">合約收入</dt>
            <dd className="mt-0.5 text-base font-bold text-ink">
              <Money value={data.revenue} compact />
            </dd>
          </div>
          <div>
            <dt className="text-ink-3">工程成本</dt>
            <dd className="mt-0.5 text-base font-bold text-ink">
              <Money value={view.cost} compact />
            </dd>
          </div>
          <div>
            <dt className="text-ink-3">毛利</dt>
            <dd
              className="mt-0.5 text-base font-bold"
              style={{ color: gross >= 0 ? "var(--color-ontrack)" : "var(--color-delayed)" }}
            >
              <Money value={view.gross} compact />
              {view.pct !== null && (
                <span className="ml-1 text-xs font-normal">（{view.pct}%）</span>
              )}
            </dd>
          </div>
        </dl>

        {revenue > 0 && (
          <div className="mt-3">
            <ProgressBar
              value={Math.max(0, Math.min(100, 100 - pct))}
              label="成本佔合約額"
              color={gross >= 0 ? "var(--color-stage-2)" : "var(--color-delayed)"}
              compact
            />
          </div>
        )}

        <p className="mt-2 text-xs leading-relaxed text-ink-3">
          {data.note}
          {basis === "billed" && "。只算包商已送單的，案子前期會偏樂觀"}
        </p>
      </Card>
    </div>
  );
}
