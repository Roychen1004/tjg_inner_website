/**
 * 命名慣例
 *
 * 放在共用模組而不是某個頁面裡——從頁面 import 會把整個頁面
 * 拉進別人的 bundle chunk，路由分割就白做了。
 */

/** 第一期、第二期…第十期，之後用阿拉伯數字。分期超過十期本來就少見 */
const CHINESE_ORDINAL = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

export function phaseName(seq: number) {
  return `第${CHINESE_ORDINAL[seq - 1] ?? seq}期`;
}
