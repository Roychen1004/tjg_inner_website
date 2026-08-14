/**
 * 廠商下拉
 *
 * 單獨一個檔案而不是塞進 hooks/index：分包合約表單是 lazy 載入的，
 * 從 index 拿會把整份 hooks 拉進那個 chunk。
 */
import { useQuery } from "@tanstack/react-query";

import { api } from "../client";
import type { Paginated } from "../types";

export interface VendorOption {
  id: number;
  code: string;
  name: string;
  type_display: string;
  is_active: boolean;
}

export function useVendors() {
  return useQuery({
    queryKey: ["vendors", "options"],
    // 主檔幾乎不變，快取久一點。page_size 拉大是因為這是選單不是列表
    queryFn: () =>
      api
        .get<Paginated<VendorOption>>("/vendors", { page_size: 200 })
        .then((r) => r.results.filter((v) => v.is_active)),
    staleTime: 30 * 60 * 1000,
  });
}
