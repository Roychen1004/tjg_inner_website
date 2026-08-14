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
