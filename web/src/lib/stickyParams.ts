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
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

export function useStickyParams(storageKey: string, keys: string[]) {
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const hasAny = keys.some((k) => searchParams.has(k));
    if (hasAny) {
      // 網址上有東西 → 記住它
      const snapshot: Record<string, string> = {};
      for (const k of keys) {
        const v = searchParams.get(k);
        if (v) snapshot[k] = v;
      }
      localStorage.setItem(storageKey, JSON.stringify(snapshot));
      return;
    }
    // 網址是乾淨的 → 用上次記住的補回去
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
  }, [searchParams, setSearchParams, storageKey, keys.join(",")]);

  return [searchParams, setSearchParams] as const;
}
