/**
 * 專案識別色（日曆甘特用）
 *
 * Okabe–Ito 色盲安全類別色盤，固定順序、不循環生成。
 * 顏色跟著專案 id 走（id 決定順位），篩選改變清單時倖存者不換色。
 * 黃色與黑色不用：黃在白底對比不足，黑要留給文字。
 * 狀態保留色（綠／橙／紅燈號）不在此列，不會跟燈號混淆。
 */
const PALETTE = [
  "#0072b2", // 藍
  "#e69f00", // 橙
  "#009e73", // 藍綠
  "#cc79a7", // 紫粉
  "#56b4e9", // 天藍
  "#d55e00", // 磚紅
] as const;

export function projectColor(projectId: number): string {
  return PALETTE[projectId % PALETTE.length];
}

/** 淡色底（bar 的底色，文字仍用墨色系保持可讀） */
export function projectTint(projectId: number): string {
  return `color-mix(in srgb, ${projectColor(projectId)} 16%, white)`;
}
