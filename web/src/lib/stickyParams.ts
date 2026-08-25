/**
 * 記住上次的篩選條件
 *
 * 問題：篩選條件放在網址上（可以分享連結、可以回上一頁），
 * 但從導航列點進來時網址是乾淨的 `/billing`——上次選的專案與分頁就沒了。
 * 每天要看同一個案子的人，每次都要重選一遍。
 *
 * 做法：網址仍是唯一的真相來源，只是**進頁面時若網址沒帶參數，
 * 就從上次記住的補回去**。使用者主動清空篩選時也會記住「清空」這件事。
 */
import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";

export function useStickyParams(storageKey: string, keys: string[]) {
  const [searchParams, setSearchParams] = useSearchParams();
  // ★ 只在「剛進頁面」補回記住的參數。之後的每一次變化——包括清空——
  // 都只記錄不補回；不然選「全部專案」的下一瞬間，記住的專案又被塞回來，
  // 使用者永遠回不到全部（D47 修正）
  const restoredOnce = useRef(false);

  useEffect(() => {
    if (!restoredOnce.current) {
      restoredOnce.current = true;
      const hasAny = keys.some((k) => searchParams.has(k));
      if (!hasAny) {
        try {
          const saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
          const next = new URLSearchParams(searchParams);
          let changed = false;
          for (const k of keys) {
            if (saved[k]) {
              next.set(k, saved[k]);
              changed = true;
            }
          }
          if (changed) setSearchParams(next, { replace: true });
        } catch {
          // localStorage 壞掉不該讓整頁掛掉——沒有記憶就沒有記憶
          localStorage.removeItem(storageKey);
        }
        return;
      }
    }
    // 記住現況（可能是空的——「清空」也是一種要記住的選擇）
    const snapshot: Record<string, string> = {};
    for (const k of keys) {
      const v = searchParams.get(k);
      if (v) snapshot[k] = v;
    }
    localStorage.setItem(storageKey, JSON.stringify(snapshot));
  }, [searchParams, setSearchParams, storageKey, keys.join(",")]);

  return [searchParams, setSearchParams] as const;
}
