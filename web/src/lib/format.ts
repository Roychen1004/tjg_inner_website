/**
 * 數字格式
 *
 * 放共用模組而不是某個頁面裡——從頁面 import 會把整個頁面拉進別人的
 * bundle chunk，路由分割就白做了（同 lib/naming.ts）。
 */

/** 元 → 萬。KPI 卡片用；台灣談工程款的單位就是萬，不是元 */
export function fmtWan(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "──";
  return Math.round(Number(value) / 10000).toLocaleString("zh-TW");
}

/** 甘特日期標籤：平常只記「月/日」；時間軸跨年時補年份——不然 1/10 分不清是哪一年 */
export function fmtMD(iso: string, withYear = false) {
  const d = new Date(iso);
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  return withYear ? `${d.getFullYear()}/${md}` : md;
}
