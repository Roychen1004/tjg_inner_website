# 05 — API 規格

> 鐵正綱工程 內部管理系統｜Django 5 + DRF + drf-spectacular
> 版本 v0.1｜2026-08-01｜狀態：**待確認**

> 📌 **v0.3 變更（2026-08-02）**：請款狀態轉換端點由**里程碑**移到**請款事件**：
> `POST /billing-claims/{id}/transition`（原 `/billing-milestones/{id}/transition`）。
> 新增 `GET /billing-claims`、`GET /billing-milestones/{id}/progress`（觸發進度）。
> `signoff` 新增 `signoff_location` 參數。
> **完整端點清單以 `鐵正綱ERP_API規格.xlsx` 為準**，本文件保留設計理由與脈絡。

---

## 1. 設計原則

| 原則 | 說明 |
|---|---|
| **標準 REST** | 資源用名詞複數、HTTP 動詞表達操作 |
| **狀態轉換用具名 action** | 不用 `PATCH {state: "invoiced"}`，而用 `POST /transition/`——因為狀態轉換有副作用與驗證 |
| **文件自動生成** | `drf-spectacular` 從程式碼產生 OpenAPI 3，**文件永遠不會過期** |
| **後端是權限的真相** | 資料範圍在 `get_queryset()` 過濾，前端拿不到範圍外的資料 |
| **強制分頁** | 任何列表都不回傳無上限資料集（8GB 機器的硬規則） |
| **回傳操作結果與副作用** | 推進階段時一併回傳「觸發了哪筆請款」，前端不用再問一次 |

### 1.1 Base URL 與版本

依貴公司 `docs/django_rules.md` 規範：

```
<domain>/api/<version>/<模組>/<資源>
```

**Base URL**：`/api/v0.1/`（版本從 v0.1 起，正式環境由 nginx 反向代理到 Django）
**路徑結尾不加 `/`**（規範明訂）。

> 📌 **本文件 §4 之後的端點表為求可讀，一律省略 `/api/v0.1` 前綴**。
> 例如表中的 `/projects` 實際路徑是 `/api/v0.1/projects`。

---

## 2. 認證

### 2.1 機制：Session Cookie

前後端**同網域**（nginx 同時服務靜態檔與 `/api/`），所以用 Django Session 最單純：

- 不用處理 JWT 過期與 refresh
- Cookie 設 `HttpOnly` + `Secure` + `SameSite=Lax`，**JavaScript 讀不到，XSS 偷不走**
- 登出即失效，不像 JWT 要維護黑名單

### 2.2 CSRF

因為用 Cookie，必須處理 CSRF：

1. 前端啟動時呼叫 `GET /api/auth/csrf/`，Django 種下 `csrftoken` cookie
2. 之後所有 `POST`/`PATCH`/`PUT`/`DELETE` 都要帶 `X-CSRFToken` header

```ts
// 前端統一在 fetch wrapper 處理
headers: { 'X-CSRFToken': getCookie('csrftoken') }
credentials: 'include'
```

### 2.3 認證端點

| 方法 | 路徑 | 說明 |
|---|---|---|
| `GET` | `/api/auth/csrf/` | 取得 CSRF token（種 cookie） |
| `POST` | `/api/auth/login/` | 登入 |
| `POST` | `/api/auth/logout/` | 登出 |
| `GET` | `/api/auth/me/` | 取得目前使用者、角色與可見範圍 |
| `POST` | `/api/auth/change-password/` | 修改密碼 |

**`POST /api/auth/login/`**

```json
// Request
{ "username": "chen", "password": "••••••••" }

// 200 OK
{
  "id": 7,
  "username": "chen",
  "employee_no": "E014",
  "name": "陳師傅",
  "department": { "id": 2, "name": "生產部" },
  "title": "焊接技師",
  "roles": ["worker"],
  "must_change_password": false,
  "default_route": "/my-work"
}

// 401 Unauthorized
{ "type": "authentication_failed", "detail": "帳號或密碼錯誤" }

// 429 Too Many Requests
{ "type": "throttled", "detail": "嘗試次數過多，請 15 分鐘後再試", "retry_after": 900 }
```

> 💡 `default_route` 由後端決定：`worker` → `/my-work`，其餘 → `/dashboard`。
> 前端不用寫「哪個角色去哪」的邏輯。

**`GET /api/auth/me/`**

```json
{
  "id": 3, "name": "王志明", "roles": ["pm"],
  "permissions": {
    "can_create_project": true,
    "can_advance_project_stage": true,
    "can_transition_billing": false,
    "can_view_amounts": true,
    "can_manage_masters": false
  },
  "visible_nav": ["dashboard", "projects", "tracking", "billing", "lines"],
  "owned_project_ids": [1, 3]
}
```

> 💡 `permissions` 與 `visible_nav` 讓前端**不必重複實作權限規則**——
> 但這只是 UI 提示，**真正的攔截一律在後端**。

### 2.4 Session 設定

| 設定 | 值 |
|---|---|
| `SESSION_COOKIE_AGE` | 8 小時 |
| `SESSION_SAVE_EVERY_REQUEST` | `True`（有活動就延長） |
| 閒置逾時 | 2 小時（中介層檢查 `last_activity`） |
| `SESSION_ENGINE` | `django.contrib.sessions.backends.db`（**不用 Redis**） |
| 登入失敗鎖定 | 連續 5 次 → 鎖 15 分鐘（`django-axes`） |

---

## 3. 通用慣例

### 3.1 分頁

所有列表端點統一使用 `PageNumberPagination`：

```
GET /api/projects/?page=2&page_size=20
```

```json
{
  "count": 57,
  "next": "/api/projects/?page=3&page_size=20",
  "previous": "/api/projects/?page=1&page_size=20",
  "results": [ ... ]
}
```

| 參數 | 預設 | 上限 |
|---|---|---|
| `page` | 1 | — |
| `page_size` | 20 | **100（硬上限，超過自動截斷）** |

> ⚠️ **沒有「取得全部」的選項。** 這是 8GB 機器的硬規則——
> 若前端需要完整清單（如下拉選單），改用專用的精簡端點（只回 id + name）。

### 3.2 篩選、搜尋、排序

```
GET /api/tracking-units/?project=1&status=delayed&q=鋼柱&ordering=-stage_entered_at
```

| 參數 | 說明 |
|---|---|
| 欄位名 | 精確比對，如 `?status=delayed` |
| 多值 | 逗號分隔，如 `?status=atrisk,delayed` |
| `q` | 模糊搜尋（各端點指定搜尋欄位） |
| `ordering` | 排序，`-` 前綴為降冪 |

實作用 `django-filter` + DRF `SearchFilter` / `OrderingFilter`。

### 3.3 日期與時間格式

| 型別 | 格式 | 範例 |
|---|---|---|
| 日期 | `YYYY-MM-DD` | `2026-06-08` |
| 時間戳 | ISO 8601 UTC | `2026-06-08T02:15:00Z` |

**所有時間戳以 UTC 傳輸**，前端轉為 `Asia/Taipei` 顯示。

### 3.4 金額與數量

| 型別 | 傳輸格式 | 說明 |
|---|---|---|
| 金額 | **字串** `"24000000.00"` | **單位：新台幣元**。用字串避免 JS 浮點誤差 |
| 數量 | 字串 `"48.00"` | 同上 |
| 百分比 | 數字 `60.0` | 顯示用，精度要求低 |

> ⚠️ **金額用字串傳輸**：JavaScript 的 `Number` 是 IEEE 754 雙精度，
> 大額金錢運算會失真。前端用 `decimal.js` 或只做顯示不做運算。

### 3.5 錯誤格式

統一由自訂 `EXCEPTION_HANDLER` 產生：

```json
{
  "type": "validation_error",
  "detail": "資料驗證失敗",
  "errors": [
    { "field": "qty_done", "code": "max_value", "message": "已完成數量不可超過總數量" },
    { "field": "reason_category", "code": "required", "message": "回退時必須選擇原因類別" }
  ]
}
```

| HTTP | `type` | 情境 |
|---|---|---|
| 400 | `validation_error` | 欄位驗證失敗 |
| 400 | `business_rule_error` | 業務規則違反（如「不可跳階」） |
| 401 | `authentication_failed` | 未登入或憑證錯誤 |
| 403 | `permission_denied` | 已登入但無權限 |
| 404 | `not_found` | 資源不存在**或不在可見範圍內** |
| 409 | `conflict` | 併發衝突（如階段已被他人變更） |
| 413 | `file_too_large` | 附件超過 20MB |
| 429 | `throttled` | 請求過於頻繁 |
| 500 | `server_error` | 伺服器錯誤（不洩漏堆疊） |

> 💡 **無權限的資料回 404 而非 403**：不讓使用者從錯誤碼推測「有這筆資料但我看不到」。

### 3.6 流量限制

| 對象 | 限制 |
|---|---|
| 未登入 | 20 次／分鐘 |
| 已登入 | 300 次／分鐘 |
| 登入端點 | 10 次／分鐘／IP |
| 檔案上傳 | 30 次／小時 |

用 DRF 內建 `throttling`，計數存資料庫快取表（**不用 Redis**）。

---

## 4. 端點總表（P1）

| 群組 | 方法 | 路徑 | UC |
|---|---|---|---|
| **認證** | GET | `/api/auth/csrf/` | — |
| | POST | `/api/auth/login/` | UC-M0-01 |
| | POST | `/api/auth/logout/` | — |
| | GET | `/api/auth/me/` | UC-M0-01 |
| | POST | `/api/auth/change-password/` | — |
| **主檔（唯讀）** | GET | `/api/customers/` | UC-M0-05 |
| | GET | `/api/vendors/` | UC-M0-06 |
| | GET | `/api/users/` | — |
| | GET | `/api/departments/` | UC-M0-03 |
| | GET | `/api/stage-templates/` | UC-M0-04 |
| **專案** | GET/POST | `/api/projects/` | UC-M1-01/06 |
| | GET/PATCH/DELETE | `/api/projects/{id}/` | UC-M1-02 |
| | POST | `/api/projects/{id}/advance-stage/` | UC-M1-03 |
| | GET | `/api/projects/{id}/summary/` | UC-M1-06 |
| | GET | `/api/projects/{id}/stage-logs/` | UC-M1-03 |
| | GET/POST | `/api/project-phases/` | UC-M1-04 |
| **變更單** | GET/POST | `/api/change-orders/` | UC-M1-05 |
| | POST | `/api/change-orders/{id}/approve/` | UC-M1-05 |
| **追蹤單元** ★ | GET/POST | `/api/tracking-units/` | UC-M2-01/02/07 |
| | GET/PATCH/DELETE | `/api/tracking-units/{id}/` | — |
| | POST | `/api/tracking-units/{id}/move-stage/` | **UC-M2-03/04** |
| | POST | `/api/tracking-units/{id}/report-progress/` | **UC-M2-05** |
| | GET | `/api/tracking-units/{id}/stage-logs/` | UC-M2-08 |
| | GET | `/api/tracking-units/{id}/progress-logs/` | UC-M2-05 |
| | GET | `/api/my-work/` | **UC-M2-09** |
| **請款** | GET/POST | `/billing-milestones` | UC-M3-01 |
| | GET/PATCH/DELETE | `/api/billing-milestones/{id}/` | — |
| | GET | `/billing-milestones/{id}/progress` ★ | 觸發進度 |
| | GET/POST | `/billing-claims` ★ | 請款事件 |
| | POST | `/billing-claims/{id}/transition` ★ | **UC-M3-03** |
| | GET | `/api/billing-milestones/{id}/logs/` | — |
| **產線** | GET/POST | `/api/production-lines/` | UC-M2-10 |
| | GET/PATCH/DELETE | `/api/production-lines/{id}/` | — |
| **儀表板** | GET | `/api/dashboard/overview/` | **UC-M12-01** |
| | GET | `/api/dashboard/attention/` | **UC-M12-02** |
| | GET | `/api/activities/` | — |
| **通知** | GET | `/api/notifications/` | UC-M0-09 |
| | GET | `/api/notifications/unread-count/` | — |
| | POST | `/api/notifications/{id}/read/` | — |
| | POST | `/api/notifications/read-all/` | — |
| **附件** | GET/POST | `/api/attachments/` | UC-M0-07 |
| | DELETE | `/api/attachments/{id}/` | — |

**共 38 個端點。** 主檔的新增／修改**全部走 Django Admin**，API 只提供唯讀（給下拉選單用）。

---

## 5. 核心端點詳細規格

---

### 5.1 `GET /api/projects/` 專案清單

**查詢參數**

| 參數 | 型別 | 說明 |
|---|---|---|
| `project_type` | enum | `civil`/`steel`/`mixed` |
| `status` | enum（可多值） | `ontrack`/`atrisk`/`delayed` |
| `owner` | int | 負責人 id；`me` 表示自己 |
| `customer` | int | 客戶 id |
| `is_closed` | bool | 預設不過濾 |
| `q` | string | 搜尋案名、專案編號、客戶名稱 |
| `ordering` | string | `due_date`/`-created_at`/`name`（預設 `-created_at`） |

**200 OK**

```json
{
  "count": 3,
  "next": null,
  "previous": null,
  "results": [
    {
      "id": 1,
      "code": "P-2026-001",
      "name": "固越企業總部案",
      "project_type": "steel",
      "customer": { "id": 1, "name": "固越企業" },
      "contract_amount": "80000000.00",
      "effective_amount": "80000000.00",
      "owner": { "id": 3, "name": "王志明" },
      "start_date": "2026-03-15",
      "due_date": "2026-11-30",
      "is_overdue": false,
      "main_stage": { "id": 5, "seq": 5, "name": "施工中", "color": "#f59e0b" },
      "main_stage_seq": 5,
      "main_stage_total": 7,
      "status": "ontrack",
      "is_closed": false,
      "unit_count": 4,
      "received_amount": "24000000.00",
      "collection_rate": 30.0,
      "note": "三期並行，第一期安裝中",
      "can_advance": true,
      "can_edit": true
    }
  ]
}
```

**可見範圍**（依 `01_營運流程盤點與角色權限.md` §9）

- `owner`/`admin`/`finance` → 全部，含金額
- `pm` → 自己負責的完整；其他案的 `contract_amount`、`received_amount`、`collection_rate` 回 `null`
- `worker` → **403**（此端點不對現場人員開放）

---

### 5.2 `POST /api/projects/{id}/advance-stage/` 推進主線階段

```json
// Request
{ "direction": "forward", "note": "報價已送出並確認" }
```

| 欄位 | 必填 | 說明 |
|---|---|---|
| `direction` | ✅ | `forward` 或 `backward` |
| `note` | `backward` 時**必填** | 原因說明 |
| `confirm_close` | 否 | 推進到「結案」且有未收款時，需帶 `true` 才執行 |

**200 OK**

```json
{
  "project": { "...更新後的專案物件..." },
  "stage_log": {
    "id": 88,
    "from_stage_name": "報價",
    "to_stage_name": "採購備料",
    "direction": "forward",
    "moved_by": { "id": 3, "name": "王志明" },
    "moved_at": "2026-08-01T06:30:00Z",
    "note": "報價已送出並確認"
  }
}
```

**409 Conflict**（結案前檢查未通過）

```json
{
  "type": "confirmation_required",
  "detail": "尚有款項未收，請確認是否結案",
  "context": {
    "unreceived_count": 2,
    "unreceived_amount": "12000000.00",
    "incomplete_units": 3
  },
  "hint": "帶入 confirm_close=true 以繼續"
}
```

**400 business_rule_error**：已在最終階段／已在第一階段／`backward` 未填 `note`

---

### 5.3 `GET /api/tracking-units/` 追蹤單元清單 ★

**查詢參數**

| 參數 | 型別 | 說明 |
|---|---|---|
| `project` | int | 專案 id |
| `phase` | int | 期別 id |
| `unit_type` | enum | `batch`/`work_item` |
| `stage` | int（可多值） | 目前階段 id |
| `status` | enum（可多值） | |
| `assignee` | int / `me` | 指派對象 |
| `work_mode` | enum | `self`/`outsource` |
| `overdue_outsource` | bool | 只列外包逾期未回廠 |
| `q` | string | 搜尋單元名稱、編號 |
| `ordering` | string | 預設 `stage__seq,name` |

**200 OK（單筆結構）**

```json
{
  "id": 123,
  "code": "B-2026-0123",
  "project": { "id": 1, "code": "P-2026-001", "name": "固越企業總部案" },
  "phase": { "id": 1, "name": "第一期" },
  "unit_type": "batch",
  "name": "第一期-1F鋼柱",

  "current_stage": {
    "id": 14, "seq": 6, "code": "deliver", "name": "出貨進場", "color": "#10b981",
    "is_billing_trigger": true, "is_outsource": false, "is_hold": false, "is_core": false
  },
  "stage_seq": 6,
  "stage_total": 8,
  "stage_entered_at": "2026-06-08T02:15:00Z",
  "days_in_stage": 3,
  "is_stalled": false,

  "assignee": { "id": 7, "name": "陳師傅" },
  "status": "ontrack",

  "qty_total": "80.00",
  "qty_done": "48.00",
  "unit_of_measure": "支",
  "progress_pct": null,
  "completion_ratio": 60.0,

  "work_mode": "self",
  "outsource_vendor": null,
  "outsource_in_date": null,
  "outsource_due_date": null,
  "outsource_out_date": null,
  "is_outsource_overdue": false,

  "subcontractor": null,
  "transport_vendor": { "id": 5, "name": "大發板車運輸" },

  "plan_start": "2026-05-01", "plan_end": "2026-06-30",
  "actual_start": "2026-05-03", "actual_end": null,
  "rollback_count": 0,
  "note": "工地組立中",

  "can_advance": true,
  "can_rollback": true,
  "can_report_progress": true
}
```

> 💡 **`completion_ratio` 是統一欄位**：
> 構件批次 = `qty_done / qty_total × 100`，土建工項 = `progress_pct`。
> 前端只要一個進度條元件，不用寫 `if (unit_type === 'batch')`。

> 💡 **`can_*` 是權限提示**：後端已算好這個使用者能不能做這件事，
> 前端直接決定按鈕要不要顯示，不必重複實作權限規則。

---

### 5.4 `POST /api/tracking-units/{id}/move-stage/` 推進／回退階段 ★★

**這是全系統最重要的端點。**

```json
// Request（推進）
{ "direction": "forward", "note": "已裝車出貨" }

// Request（回退，原因必填）
{
  "direction": "backward",
  "reason_category": "qc_fail",
  "note": "焊道有氣孔，退回重工"
}
```

| 欄位 | 必填 | 說明 |
|---|---|---|
| `direction` | ✅ | `forward` / `backward`（**一次只能一階**） |
| `reason_category` | `backward` 時✅ | 見 `04_資料庫規劃.md` §5.4 |
| `note` | `backward` 時✅ | 說明文字 |

**200 OK**

```json
{
  "unit": { "...更新後的追蹤單元..." },
  "stage_log": {
    "id": 456,
    "from_stage_name": "置料區",
    "to_stage_name": "出貨進場",
    "direction": "forward",
    "moved_by": { "id": 5, "name": "李廠長" },
    "moved_at": "2026-08-01T06:45:00Z",
    "note": "已裝車出貨"
  },
  "side_effects": {
    "billing_triggered": {
      "milestone_id": 42,
      "label": "第一期請款",
      "amount": "24000000.00",
      "from_state": "pending",
      "to_state": "claimable"
    },
    "status_changed": null,
    "warnings": []
  }
}
```

> 💡 **`side_effects` 讓前端可以立刻跳出「已觸發第一期請款 2,400 萬」的提示**，
> 不用再打一次 API 才知道發生了什麼。

**回退的回應**

```json
{
  "unit": { "...status 已變為 atrisk..." },
  "stage_log": { "direction": "backward", "reason_category": "qc_fail", ... },
  "side_effects": {
    "billing_triggered": null,
    "status_changed": { "from": "ontrack", "to": "atrisk", "reason": "階段回退" },
    "warnings": ["此單元已回退 2 次，狀態升級為延誤"]
  }
}
```

**錯誤情境**

| HTTP | `type` | 訊息 |
|---|---|---|
| 400 | `business_rule_error` | 已在最終階段，無法再推進 |
| 400 | `validation_error` | 回退時必須填寫原因類別與說明 |
| 403 | `permission_denied` | 此追蹤單元未指派給你 |
| 409 | `conflict` | 階段已被他人變更，請重新整理（樂觀鎖偵測） |

**實作要點**

```python
with transaction.atomic():
    unit = TrackingUnit.objects.select_for_update().get(pk=pk)   # 行鎖，防併發
    # 驗證：只能 ±1 階
    # 更新 current_stage、stage_entered_at
    # 寫 TrackingUnitStageLog（含階段名稱快照）
    # 寫 ActivityLog
# ↓ 交易外，失敗不影響主流程
trigger_billing_if_needed(unit, to_stage)
create_notifications(...)
```

---

### 5.5 `POST /api/tracking-units/{id}/report-progress/` 回報進度 ★

```json
// 方式一：絕對值（手動輸入）
{ "qty_done": 58, "note": "" }

// 方式二：增量（+5 快速按鈕）★推薦
{ "delta": 5 }

// 土建工項
{ "progress_pct": 65 }
```

| 欄位 | 說明 |
|---|---|
| `qty_done` | 構件批次絕對值 |
| `delta` | **增量，用 `F()` 原子更新，避免兩人同時回報造成 lost update** |
| `progress_pct` | 土建工項絕對值 |
| `note` | **往回改時必填** |

> 💡 **快速按鈕一律送 `delta`**：兩個師傅同時各回報 `+5`，用 `delta` 結果正確加 10；
> 用絕對值則後者覆蓋前者，少算 5 支。

**200 OK**

```json
{
  "unit": { "qty_done": "58.00", "completion_ratio": 72.5, ... },
  "progress_log": {
    "id": 789,
    "qty_before": "53.00", "qty_after": "58.00", "delta": "5.00",
    "reported_by": { "id": 7, "name": "陳師傅" },
    "reported_at": "2026-08-01T09:20:00Z"
  },
  "suggestion": null
}
```

**達成 100% 時**

```json
{
  "unit": { "qty_done": "80.00", "completion_ratio": 100.0, ... },
  "progress_log": { ... },
  "suggestion": {
    "type": "advance_stage",
    "message": "已達 100%，是否推進至「品檢」？",
    "next_stage": { "id": 11, "name": "品檢" }
  }
}
```

**錯誤**

| HTTP | 訊息 |
|---|---|
| 400 | 已完成數量不可超過總數量（80） |
| 400 | 完成百分比必須介於 0 與 100 之間 |
| 400 | 數值調降時必須填寫備註 |
| 403 | 此追蹤單元未指派給你 |

---

### 5.6 `GET /api/my-work/` 我的工作 ★（手機主畫面）

**專用端點**，不是 `/api/tracking-units/?assignee=me` 的別名——它做了三件不同的事：

1. **只回傳指派給自己的單元**（無論角色）
2. **依急迫性排序**：延誤 → 注意 → 正常
3. **序列化器不含任何金額欄位**（在後端就拿掉，不是前端隱藏）

**200 OK**

```json
{
  "count": 4,
  "results": [
    {
      "id": 130,
      "name": "第二期-2F鋼柱",
      "project_name": "固越企業總部案",
      "unit_type": "batch",
      "current_stage": { "name": "加工", "color": "#f59e0b", "seq": 2, "total": 8 },
      "status": "atrisk",
      "status_reason": "已在此階段停留 9 天",
      "qty_done": "20.00", "qty_total": "64.00", "unit_of_measure": "支",
      "completion_ratio": 31.3,
      "can_advance": true,
      "can_report_progress": true,
      "quick_increments": [1, 5, 10]
    }
  ]
}
```

> 💡 `quick_increments` 由後端依單位決定：「支／組／片／件」給 `[1,5,10]`，「噸」給 `[0.5,1,5]`。
> 前端不用寫這個判斷邏輯。

**不分頁**——一個人的工作通常 < 10 筆，硬上限 50 筆。

---

### 5.7 `POST /api/billing-milestones/{id}/transition/` 請款狀態轉換

```json
// 轉為已請款
{ "to_state": "invoiced", "invoice_date": "2026-06-08", "invoice_no": "INV-2026-0142" }

// 轉為已收款
{ "to_state": "received", "receive_date": "2026-07-05" }

// 往回轉（必填原因）
{ "to_state": "claimable", "reason": "發票開錯金額，作廢重開" }
```

**允許的狀態轉換**

| 從 | 可轉到 | 需要 |
|---|---|---|
| `pending` | `claimable` | — |
| `claimable` | `invoiced` | `invoice_date` |
| `claimable` | `pending` | `reason` |
| `invoiced` | `received` | `receive_date` |
| `invoiced` | `claimable` | `reason` |
| `received` | `invoiced` | `reason` + `owner` 角色 |

**200 OK**

```json
{
  "milestone": {
    "id": 42, "label": "第一期請款", "percentage": 30.0,
    "amount": "24000000.00", "state": "invoiced",
    "invoice_date": "2026-06-08", "invoice_no": "INV-2026-0142", "receive_date": null
  },
  "log": { "from_state": "claimable", "to_state": "invoiced", "is_auto": false, ... },
  "project_summary": {
    "received_amount": "24000000.00",
    "billable_amount": "24000000.00",
    "collection_rate": 30.0
  }
}
```

> 💡 一併回傳 `project_summary`，前端可立即更新儀表板數字，不用重新載入。

**錯誤**

| HTTP | 訊息 |
|---|---|
| 400 | 不允許從「未到」直接轉為「已收款」 |
| 400 | 收款日不可早於請款日 |
| 400 | 狀態往回調整時必須填寫原因 |
| 403 | 只有會計與經營者可以變更請款狀態 |

---

### 5.8 `GET /api/dashboard/overview/` 營運總覽

**一次請求取得整個儀表板**（US-050 要求「不發出 5 個以上的請求」）。

**200 OK**

```json
{
  "cards": {
    "active_projects": 3,
    "attention_count": 5,
    "collection_rate": 42.5,
    "receivable_outstanding": "16800000.00",
    "avg_utilization": 68.2
  },
  "project_collections": [
    {
      "project_id": 1, "name": "固越企業總部案",
      "contract_amount": "80000000.00", "received_amount": "24000000.00",
      "collection_rate": 30.0
    }
  ],
  "attention_top": [
    {
      "kind": "tracking_unit", "id": 130,
      "title": "固越企業總部案·第二期-2F鋼柱",
      "subtitle": "加工・已停留 9 天",
      "status": "atrisk",
      "link": "/tracking?unit=130"
    }
  ],
  "stage_distribution": [
    { "stage_id": 9, "name": "進料驗收", "color": "#06b6d4", "count": 1 },
    { "stage_id": 10, "name": "加工", "color": "#f59e0b", "count": 2 }
  ],
  "recent_activities": [
    {
      "id": 901,
      "verb": "固越案·第一期樓板鋼樑 送往 全興噴砂廠 表面處理",
      "category": "tracking",
      "created_at": "2026-08-01T06:12:00Z"
    }
  ],
  "generated_at": "2026-08-01T09:30:00Z"
}
```

**角色差異**：`plant_mgr` 的回應中 `collection_rate`、`receivable_outstanding`、`project_collections` 為 `null`／空陣列。

**效能要求**
- 全部聚合用 `annotate()` + `aggregate()` 在資料庫完成，**不在 Python 迴圈算**
- 目標 p95 < 300ms
- 快取 60 秒（Django `cache_page`，用資料庫快取表）

---

### 5.9 `GET /api/dashboard/attention/` 需要關注清單

**查詢參數**：`kind`（`project`/`tracking_unit`/`billing`）、`severity`（`atrisk`/`delayed`）、分頁

**200 OK**

```json
{
  "count": 5,
  "results": [
    {
      "kind": "tracking_unit", "id": 130,
      "title": "固越企業總部案·第二期-2F鋼柱",
      "subtitle": "加工",
      "reason_code": "stalled",
      "reason": "已在此階段停留 9 天（門檻 7 天）",
      "status": "atrisk",
      "since": "2026-07-23T01:00:00Z",
      "link": "/tracking?unit=130"
    },
    {
      "kind": "billing", "id": 42,
      "title": "彰化食品廠房擴建·第一期請款",
      "subtitle": "NT$ 960 萬",
      "reason_code": "claimable_overdue",
      "reason": "可請款已 12 天尚未開立請款單",
      "status": "atrisk",
      "link": "/billing?milestone=42"
    }
  ]
}
```

**`reason_code` 對照**

| 代碼 | 說明 |
|---|---|
| `project_overdue` | 專案預計完工日已過且未結案 |
| `stalled` | 追蹤單元在同一階段停留超過 `stall_days` |
| `outsource_overdue` | 外包逾期未回廠 |
| `outsource_missing_info` | 已進外包階段但未填協力廠 |
| `claimable_overdue` | 可請款超過 7 天未請款 |
| `receivable_overdue` | 已請款超過 60 天未收款 |
| `no_milestone` | 已觸發請款但找不到對應里程碑 |
| `manual` | 人工標記為注意／延誤 |

---

### 5.10 `POST /api/attachments/` 上傳附件

`Content-Type: multipart/form-data`

| 欄位 | 說明 |
|---|---|
| `file` | 檔案本體 |
| `content_type` | 掛在哪：`project` / `trackingunit` / `billingmilestone` |
| `object_id` | 對象 id |
| `note` | 備註 |

**限制**：單檔 ≤ 20MB；允許 `pdf/jpg/jpeg/png/xlsx/dwg`；檔名以 UUID 重新命名。

**413 File Too Large**

```json
{ "type": "file_too_large", "detail": "檔案大小 25.3MB 超過上限 20MB" }
```

---

## 6. OpenAPI 自動文件

### 6.0 ⚠️ 套件選擇待確認

貴公司規範（`docs/django_rules.md` § Swagger API）指定 **`drf_yasg`**，路徑為
`{API_ROOT}/{API_VERSION}/swagger/` 與 `/redoc/`。但兩者有實質差異：

| | `drf_yasg`（規範指定） | `drf-spectacular`（建議） |
|---|---|---|
| 輸出規格 | **Swagger 2.0** | **OpenAPI 3** |
| 前端 TS 型別自動生成 | ❌ 主流工具都要 OpenAPI 3 | ✅ `openapi-typescript` 直接吃 |
| 維護狀態 | 更新趨緩 | 活躍 |
| Swagger UI / ReDoc | ✅ | ✅ |

**影響**：若照規範用 `drf_yasg`，前端 38 個端點的 TypeScript 型別必須**手寫維護**，
後端改欄位時前端不會編譯失敗——這正是型別安全最想避免的情況。

**建議**：用 `drf-spectacular`，但**沿用規範的路徑格式**（`/api/v0.1/swagger/`、`/api/v0.1/redoc/`），
對使用者而言介面完全一樣。

### 6.1 產生方式（drf-spectacular）

```python
# main/settings/base.py
INSTALLED_APPS += ['drf_spectacular']
REST_FRAMEWORK = {'DEFAULT_SCHEMA_CLASS': 'drf_spectacular.openapi.AutoSchema'}
SPECTACULAR_SETTINGS = {
    'TITLE': '鐵正綱工程 內部管理系統 API',
    'VERSION': 'v0.1',
    'SERVE_INCLUDE_SCHEMA': False,
    'COMPONENT_SPLIT_REQUEST': True,
}
```

```python
# main/urls.py — 沿用規範的路徑格式
path(f'{API_ROOT}/{API_VERSION}/schema', SpectacularAPIView.as_view()),
path(f'{API_ROOT}/{API_VERSION}/swagger', SpectacularSwaggerView.as_view()),
path(f'{API_ROOT}/{API_VERSION}/redoc',   SpectacularRedocView.as_view()),
```

| 路徑 | 內容 |
|---|---|
| `/api/v0.1/schema` | OpenAPI 3 YAML |
| `/api/v0.1/swagger` | **互動式文件，可直接試打 API** |
| `/api/v0.1/redoc` | 閱讀用文件 |

> ⚠️ 正式環境的這三個路徑**限內網 IP 存取**。

### 6.2 前端型別同步

```bash
# 後端產出 schema
python manage.py spectacular --file openapi.yaml

# 前端產生 TypeScript 型別
npx openapi-typescript openapi.yaml -o src/api/schema.d.ts
```

放進 `Makefile`，每次改完 serializer 就跑一次：

```makefile
api-types:
	docker compose exec api python manage.py spectacular --file /shared/openapi.yaml
	cd web && npx openapi-typescript ../shared/openapi.yaml -o src/api/schema.d.ts
```

**前端型別永遠與後端一致，不手抄。** 後端改了欄位型別，前端 `tsc` 立刻報錯。

---

## 7. 效能與資源限制

8GB 機器的硬性要求：

| 項目 | 規則 |
|---|---|
| 分頁上限 | `page_size` 硬上限 100，**無「全部」選項** |
| N+1 查詢 | 所有 ViewSet 必須 `select_related` / `prefetch_related`；開發期用 `nplusone` 套件自動偵測並拋錯 |
| 聚合運算 | 一律用 ORM `annotate`/`aggregate` 在資料庫算，**不在 Python 迴圈跑** |
| 大量匯出 | 用 `StreamingHttpResponse` + `queryset.iterator(chunk_size=500)`，**不在記憶體組完整檔案** |
| 回應時間 | 列表 p95 < 300ms；儀表板 p95 < 500ms |
| 單一請求記憶體 | < 50MB |
| 快取 | 儀表板快取 60 秒，用 Django 資料庫快取表（`createcachetable`），**不用 Redis** |

### 7.1 效能檢查清單（每個新端點都要過）

- [ ] 有沒有 `select_related` / `prefetch_related`？
- [ ] 有沒有用到索引？（`EXPLAIN ANALYZE` 確認沒有 Seq Scan）
- [ ] 列表有沒有分頁？
- [ ] 聚合是不是在資料庫做的？
- [ ] 資料量成長 10 倍後還撐得住嗎？

---

## 8. 本文件的確認方式

- [ ] **§6.0 ⚠️ Swagger 套件**：規範指定 `drf_yasg`（Swagger 2.0），但前端型別自動生成需要 OpenAPI 3。要照規範還是改用 `drf-spectacular`？
- [ ] **§1.1 Actor 是否用 DRF**：規範的 actor 範例註明「do not use restframework」，但同時要求 `serializers/` 與 `drf_yasg`。本系統 38 個端點若不用 DRF，樣板程式碼會多很多——請確認
- [ ] §2.1 用 Session Cookie 而非 JWT，可以接受嗎？（若未來要做手機原生 App 才需要改 JWT）
- [ ] §3.4 金額用字串傳輸、單位為「元」，前端顯示轉「萬」，可以接受嗎？
- [ ] §5.4 `move-stage` 只允許 ±1 階，實務上會不會需要跳階？
- [ ] §5.5 快速按鈕的 `delta` 級距，「噸」給 `[0.5, 1, 5]` 合理嗎？
- [ ] §5.9 `reason_code` 的門檻天數（停滯 7 天／可請款 7 天／已請款 60 天）合適嗎？
- [ ] §5.10 附件 20MB 上限夠嗎？（圖紙 PDF 可能很大）

---

## 相關文件

`02_Use_Case規格.md`｜`03_User_Story與驗收條件.md`｜`04_資料庫規劃.md`｜`07_系統架構與開發路線圖.md`
