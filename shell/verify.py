#!/usr/bin/env python3
"""
簡化後全流程驗收

跑法（需要系統已啟動並載入 demo 資料）：
    BASE=http://localhost:30080 python3 shell/verify.py

⚠️ 一定要**打過 nginx**（預設 :30080），不要直連 api:8000——
附件下載走 X-Accel-Redirect，沒有 nginx 在前面會拿到 0 bytes 的空回應。

驗的是「實際打 API 會發生什麼」，不是單元邏輯：
一頁式建案、應收四狀態、權限先於業務規則、金額不外洩、現金流三級。

⚠️ 會動到示範資料（核可付款、建測試帳號）。跑完想要乾淨的示範資料：
    docker compose exec api python manage.py seed_demo --clear
"""
import io
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from http.cookiejar import CookieJar

BASE = os.environ.get("BASE", "http://localhost:30080")
API = f"{BASE}/api/v0.1"
PASSWORD = os.environ.get("SEED_DEMO_PASSWORD", "28494320")

# D40 名冊的密碼（與 docs/帳號密碼.md 同步）；沒列的帳號用 SEED_DEMO_PASSWORD
ACCOUNTS = {
    "manager": "j926qa8z",
    "accountant": "uc6j6cw2",
    "drafter": "k9kswbac",
    "worker01": "ucwpfpu9",
}

PASS, FAIL = [], []


def check(name, condition, detail=""):
    (PASS if condition else FAIL).append(name)
    mark = "✔" if condition else "✘"
    line = f"  {mark} {name}"
    if detail and not condition:
        line += f"\n      → {detail}"
    print(line)
    return condition


class Client:
    """一個帳號一個 client。cookie 分開，才驗得出權限隔離。"""

    def __init__(self, username, password=None):
        self.username = username
        self.password = password or ACCOUNTS.get(username, PASSWORD)
        self.jar = CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar)
        )
        self.status = 0

    def _csrf(self):
        return next((c.value for c in self.jar if c.name == "csrftoken"), "")

    def request(self, method, path, body=None, files=None, raw=False):
        url = path if path.startswith("http") else f"{API}{path}"
        # 查詢字串帶中文時 http.client 會炸 ascii——先把非 ASCII 編掉
        url = urllib.parse.quote(url, safe=":/?&=%-_.~")
        headers = {"Referer": BASE}
        data = None

        if files is not None:
            boundary = "----tjgverify"
            buf = io.BytesIO()
            for key, value in (body or {}).items():
                buf.write(f"--{boundary}\r\n".encode())
                buf.write(f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode())
                buf.write(f"{value}\r\n".encode())
            for key, (filename, content, mime) in files.items():
                buf.write(f"--{boundary}\r\n".encode())
                buf.write(
                    f'Content-Disposition: form-data; name="{key}"; filename="{filename}"\r\n'.encode()
                )
                buf.write(f"Content-Type: {mime}\r\n\r\n".encode())
                buf.write(content)
                buf.write(b"\r\n")
            buf.write(f"--{boundary}--\r\n".encode())
            data = buf.getvalue()
            headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
        elif body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"

        if method not in ("GET", "HEAD"):
            headers["X-CSRFToken"] = self._csrf()

        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with self.opener.open(req) as response:
                self.status = response.status
                payload = response.read()
                if raw:
                    return {"_body": payload, "_headers": dict(response.headers)}
                return json.loads(payload) if payload else {}
        except urllib.error.HTTPError as exc:
            self.status = exc.code
            payload = exc.read()
            try:
                return json.loads(payload) if payload else {}
            except json.JSONDecodeError:
                return {"detail": payload[:200].decode("utf-8", "replace")}

    def get(self, path, raw=False):
        return self.request("GET", path, raw=raw)

    def post(self, path, body=None, files=None):
        return self.request("POST", path, body=body, files=files)

    def patch(self, path, body):
        return self.request("PATCH", path, body=body)

    def delete(self, path):
        return self.request("DELETE", path)

    def login(self, required=True):
        self.get("/auth/csrf")
        result = self.post(
            "/auth/login", {"username": self.username, "password": self.password}
        )
        if self.status != 200 and required:
            print(f"✘ 無法以 {self.username} 登入（{self.status}）：{result}")
            sys.exit(1)
        return self


# 最小的合法檔案。用真的檔頭，才驗得到 magic bytes 檢查
PDF = b"%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"
HTML = b"<html><script>alert('xss')</script></html>"


def main():
    stamp = int(time.time()) % 100000
    owner = Client("manager").login()
    finance = Client("accountant").login()

    # 清掉上次沒跑完留下的測試案（冪等）
    for p in owner.get("/projects?q=驗收案&page_size=20").get("results", []):
        for u in owner.get(f"/tracking-units?project={p['id']}").get("results", []):
            owner.delete(f"/tracking-units/{u['id']}")
        owner.delete(f"/projects/{p['id']}")

    # ── A. 導航與角色（D40 權限矩陣；D52 加「統計」）─────────────────
    print("\n▌A. 導航與角色（7 分頁、4 角色）")
    me = owner.get("/auth/me")
    check("經理導航是 7 個分頁（含統計）",
          me.get("visible_nav") == ["dashboard", "projects", "tracking", "mywork", "finance", "stats", "settings"],
          me.get("visible_nav"))
    me_f = finance.get("/auth/me")
    check("會計師看得到全部 7 個分頁（設定唯讀；統計只有金額區塊）",
          me_f.get("visible_nav") == ["dashboard", "projects", "tracking", "mywork", "finance", "stats", "settings"],
          me_f.get("visible_nav"))
    check("產能統計限經理（D52）：經理有、會計沒有 view_productivity",
          me.get("permissions", {}).get("view_productivity")
          and not me_f.get("permissions", {}).get("view_productivity"),
          me_f.get("permissions", {}).get("view_productivity"))
    check("會計師沒有專案／進度／主檔的編輯權",
          not me_f.get("permissions", {}).get("edit_project")
          and not me_f.get("permissions", {}).get("edit_tracking")
          and not me_f.get("permissions", {}).get("manage_masters"),
          me_f.get("permissions"))

    staff = Client("drafter").login()
    me_s = staff.get("/auth/me")
    check("員工看得到金流以外的 5 個分頁，登入直達 /mywork",
          me_s.get("visible_nav") == ["dashboard", "projects", "tracking", "mywork", "settings"]
          and me_s.get("default_route") == "/mywork",
          {k: me_s.get(k) for k in ("visible_nav", "default_route")})

    viewer_name = f"viewer{stamp}"
    created = owner.post("/employees", {
        "username": viewer_name, "name": "測試檢視", "roles": ["viewer"],
    })
    check("經理能建立員工帳號", owner.status == 201, f"{owner.status} {created}")
    viewer = Client(viewer_name).login(required=False)
    if viewer.status != 200:
        check("檢視帳號能登入", False, "登入失敗")
        viewer = None
    else:
        nav = viewer.get("/auth/me").get("visible_nav", [])
        check("檢視角色沒有金流分頁", "finance" not in nav and "dashboard" in nav, nav)

    # ── B. 建案一頁完成 ─────────────────────────────────────────────
    print("\n▌B. 建案一頁完成（勾流程＋請款分期）")
    customers = owner.get("/customers?active=true")
    customer_id = customers["results"][0]["id"]
    users = owner.get("/options")["users"]
    owner_id = next(u["id"] for u in users if u["name"] == "經理")

    catalog = owner.get("/flow-catalog")
    item_by_code = {i["code"]: i for s in catalog for i in s.get("items", [])}
    check("流程目錄：5 大階段、19 工作項",
          len(catalog) == 5 and len(item_by_code) == 19,
          f"{len(catalog)} 階段 {len(item_by_code)} 項")

    bad = owner.post("/projects", {
        "name": f"驗收案-超額-{stamp}",
        "customer": customer_id, "owner": owner_id, "contract_amount": "10000000",
        "milestones": [{"label": "一", "percentage": "60"}, {"label": "二", "percentage": "60"}],
    })
    check("分期合計超過 100% 被擋下", owner.status == 400, f"{owner.status} {bad}")

    chosen_codes = ["1.1", "3.2", "3.4", "4.1", "4.5", "5.2"]
    project = owner.post("/projects", {
        "name": f"驗收案-{stamp}",
        "customer": customer_id, "owner": owner_id, "contract_amount": "10000000",
        "flow_items": [item_by_code[c]["id"] for c in chosen_codes],
        "milestones": [
            {"label": "第一期（簽約）", "percentage": "30", "condition": "合約簽訂後"},
            {"label": "第二期（進料）", "percentage": "40",
             "trigger_flow_item": item_by_code["3.4"]["id"],
             "expected_date": str(date.today().replace(day=1))},
            {"label": "尾款（驗收）", "percentage": "30"},
        ],
    })
    check("一個請求：建案（免選鋼構／土建）＋勾 6 流程＋三期應收款",
          owner.status == 201, f"{owner.status} {project}")
    pid = project.get("id")

    detail = owner.get(f"/projects/{pid}")
    rows = detail.get("milestones", [])
    check("專案明細帶出三期", len(rows) == 3, rows)
    check("金額＝合約額×比例（30% → 300 萬）",
          rows and float(rows[0]["amount"]) == 3000000, rows and rows[0].get("amount"))
    check("順序自動編號 1,2,3", [r["seq"] for r in rows] == [1, 2, 3], rows)

    units = detail.get("flow_units", [])
    check("勾 6 個流程 → 生 6 張單元，照目錄順序",
          [u["flow_code"] for u in units] == chosen_codes, [u.get("flow_code") for u in units])
    check("第二期掛上觸發流程 3.4",
          rows and rows[1].get("trigger_unit_name") == item_by_code["3.4"]["name"],
          rows and rows[1].get("trigger_unit_name"))
    check("卡片迷你甘特資料（flow_gantt）依大階段彙總",
          [g["seq"] for g in detail.get("flow_gantt", [])] == [1, 3, 4, 5],
          detail.get("flow_gantt"))

    added = owner.post("/billing-milestones", {
        "project": pid, "label": "追加保留款", "percentage": "0",
    })
    check("加一期不用填順序，自動排最後", owner.status == 201 and added.get("seq") == 4,
          f"{owner.status} {added}")
    owner.delete(f"/billing-milestones/{added['id']}")

    # ── B2. 流程軌：指派、員工操作、順序鎖、金流自動觸發 ────────────
    print("\n▌B2. 流程軌（指派→員工完成→期別自動可請款）")
    unit_by_code = {u["flow_code"]: u for u in units}
    drafter_id = next(u["id"] for u in users if u["name"] == "繪圖師")

    r = staff.patch(f"/flow-units/{unit_by_code['3.2']['id']}", {"assignee": drafter_id})
    check("員工不能自己改排程（403）", staff.status == 403, f"{staff.status} {r}")

    r = owner.patch(f"/flow-units/{unit_by_code['3.2']['id']}", {
        "assignee": drafter_id, "description": "全區施工圖", "plan_end": str(date.today()),
    })
    check("管理者指派負責人＋寫工作內容", owner.status == 200, f"{owner.status} {r}")

    mine = staff.get("/flow-units?assignee=me")
    check("我的任務：被指派的單元出現在清單",
          any(u["id"] == unit_by_code["3.2"]["id"] for u in mine.get("results", [])),
          mine.get("count"))

    r = staff.post(f"/flow-units/{unit_by_code['3.4']['id']}/transition", {"to_state": "doing"})
    check("員工動別人的單元 → 403", staff.status == 403, f"{staff.status} {r}")

    r = staff.post(f"/flow-units/{unit_by_code['3.2']['id']}/transition", {"to_state": "done"})
    check("負責人完成自己的任務（不需主管再確認）",
          staff.status == 200 and r.get("state") == "done", f"{staff.status} {r}")

    m2 = rows[1]["id"]
    before = finance.get(f"/billing-milestones/{m2}")
    check("觸發流程還沒完成，第二期仍是未到", before.get("state") == "pending", before.get("state"))
    r = finance.post(f"/flow-units/{unit_by_code['3.4']['id']}/transition", {"to_state": "done"})
    check("會計師動別人的流程 → 403（D40：會計師只能改金流）",
          finance.status == 403, f"{finance.status} {r}")
    r = owner.post(f"/flow-units/{unit_by_code['3.4']['id']}/transition", {"to_state": "done"})
    check("經理能直接完成流程", owner.status == 200, f"{owner.status} {r}")
    after = finance.get(f"/billing-milestones/{m2}")
    check("★ 觸發流程完成 → 第二期自動轉可請款",
          after.get("state") == "claimable" and bool(after.get("claimable_at")), after.get("state"))
    logs2 = finance.get(f"/billing-milestones/{m2}/logs")
    check("自動轉換有留歷程", any("自動" in (log.get("reason") or "") for log in logs2), logs2[:1])

    r = owner.post(f"/projects/{pid}/set-flows", {
        "flow_items": [item_by_code[c]["id"] for c in ("1.1", "3.2", "3.4", "4.1", "4.5", "5.2", "5.3")],
    })
    check("編輯流程：加勾 5.3", owner.status == 200 and r.get("added") == ["尾款請款與收款"], f"{owner.status} {r}")
    r = owner.post(f"/projects/{pid}/set-flows", {
        "flow_items": [item_by_code[c]["id"] for c in ("1.1", "3.2", "3.4", "4.1", "4.5", "5.2")],
    })
    check("編輯流程：取消勾（未開始無紀錄→直接移除）",
          owner.status == 200 and r.get("removed") == ["尾款請款與收款"], f"{owner.status} {r}")

    # ── C. 應收四狀態 ───────────────────────────────────────────────
    print("\n▌C. 應收生命週期（未到→可請款→已請款→已收款）")
    today = str(date.today())
    m1 = rows[0]["id"]

    r = finance.post(f"/billing-milestones/{m1}/transition", {"to_state": "invoiced"})
    check("不可跳過中間狀態", finance.status == 400, f"{finance.status} {r}")

    r = finance.post(f"/billing-milestones/{m1}/transition", {"to_state": "claimable"})
    check("會計能轉可請款", finance.status == 200 and r.get("claimable_at"), f"{finance.status} {r}")

    r = finance.post(f"/billing-milestones/{m1}/transition",
                     {"to_state": "invoiced", "date": today, "invoice_no": "T-001"})
    check("轉已請款", finance.status == 200, f"{finance.status} {r}")
    check("預計收款日自動帶入（客戶帳期）", bool(r.get("due_date")), r)

    r = finance.post(f"/billing-milestones/{m1}/transition", {"to_state": "claimable"})
    check("往回轉沒填原因被擋下", finance.status == 400, f"{finance.status} {r}")
    r = finance.post(f"/billing-milestones/{m1}/transition",
                     {"to_state": "claimable", "reason": "單號打錯"})
    check("填了原因就能退回，請款資料清空",
          finance.status == 200 and not r.get("invoice_date") and not r.get("due_date"), r)

    finance.post(f"/billing-milestones/{m1}/transition", {"to_state": "invoiced", "date": today})
    r = finance.post(f"/billing-milestones/{m1}/transition", {"to_state": "received", "date": today})
    check("轉已收款", finance.status == 200 and r.get("receive_date") == today, f"{finance.status} {r}")

    r = finance.delete(f"/billing-milestones/{m1}")
    check("已收款的列不可刪除", finance.status == 400, f"{finance.status} {r}")

    logs = finance.get(f"/billing-milestones/{m1}/logs")
    check("每次轉換都有不可竄改歷程", len(logs) >= 5, f"{len(logs)} 筆")

    summary = finance.get("/billing-milestones/summary")
    check("應收總覽四個桶都有數字", all(k in summary for k in ("pending", "claimable", "invoiced", "received")), summary)

    if viewer:
        r = viewer.get("/billing-milestones")
        check("檢視角色打應收 API 被擋（403）", viewer.status == 403, viewer.status)
        v_detail = viewer.get(f"/projects/{pid}")
        check("檢視角色的專案明細：金額是 null、應收款是空的",
              v_detail.get("contract_amount") is None and v_detail.get("milestones") == [],
              {k: v_detail.get(k) for k in ("contract_amount", "milestones")})

    # ── D. 應付（回歸）─────────────────────────────────────────────
    print("\n▌D. 應付與職能分離")
    subcontracts = finance.get("/subcontracts")
    sc = subcontracts["results"][0]
    pending = finance.post("/payables", {
        "subcontract": sc["id"], "title": f"驗收計價-{stamp}",
        "amount": "500000", "billing_date": today,
    })
    check("會計登錄一筆計價（D48：金額即稅後，稅額 0）",
          finance.status == 201 and float(pending.get("tax_amount", 1)) == 0,
          f"{finance.status} {pending}")
    if pending:
        r = finance.post(f"/payables/{pending['id']}/transition", {"to_state": "approved"})
        check("會計按核可 → 403（權限先於業務規則）", finance.status == 403, f"{finance.status} {r}")
        r = owner.post(f"/payables/{pending['id']}/transition", {"to_state": "approved"})
        check("經營者核可", owner.status == 200, f"{owner.status} {r}")
        r = finance.post(f"/payables/{pending['id']}/transition",
                         {"to_state": "paid", "date": today, "payment_method": "transfer"})
        check("會計執行付款", finance.status == 200 and r.get("state") == "paid", f"{finance.status} {r}")

    cheque = finance.get("/payables?q=2月份鋼材")
    row = cheque["results"][0] if cheque.get("results") else {}
    check("支票列有票期（現金流用兌現日）", bool(row.get("check_due_date")), row)

    # ── E. 現金流與損益 ─────────────────────────────────────────────
    print("\n▌E. 現金流預測")
    forecast = finance.get("/cashflow/forecast?granularity=week&periods=12")
    check("現金流有格子與免責說明",
          len(forecast.get("cells", [])) == 12 and bool(forecast.get("disclaimer")), finance.status)
    kinds = {d["kind"] for c in forecast.get("cells", []) for d in c.get("details", [])}
    check("收入側來自應收款", "milestone" in kinds or forecast["totals"]["income"] != "0", kinds)
    certs = {d["certainty"] for c in forecast.get("cells", []) for d in c.get("details", [])}
    check("確定性分級存在", len(certs) >= 2, certs)

    guyue = next(p for p in owner.get("/options")["projects"] if "固越" in p["name"])
    pnl = owner.get(f"/projects/{guyue['id']}/pnl")
    check("專案損益：兩種口徑", "committed" in pnl and "billed" in pnl, pnl.keys())

    if viewer:
        viewer.get("/cashflow/forecast")
        check("檢視角色打現金流 → 403", viewer.status == 403, viewer.status)

    # ── F. 附件 ────────────────────────────────────────────────────
    print("\n▌F. 附件（權限借用母物件）")
    up = owner.post("/attachments",
                    {"target": "project", "id": pid, "category": "contract"},
                    files={"file": ("合約書.pdf", PDF, "application/pdf")})
    check("合約 PDF 上傳", owner.status == 201 and up.get("is_previewable"), f"{owner.status} {up}")

    fake = owner.post("/attachments",
                      {"target": "project", "id": pid, "category": "other"},
                      files={"file": ("evil.pdf", HTML, "application/pdf")})
    check("改副檔名的 HTML 被 magic bytes 擋下", owner.status == 400, f"{owner.status} {fake}")

    m3 = rows[2]["id"]
    up2 = owner.post("/attachments",
                     {"target": "milestone", "id": m3, "category": "invoice"},
                     files={"file": ("請款單.pdf", PDF, "application/pdf")})
    check("附件能掛在應收款上", owner.status == 201, f"{owner.status} {up2}")

    dl = owner.get(f"/attachments/{up['id']}/download", raw=True)
    headers = dl["_headers"]
    check("下載經 nginx 有內容", len(dl["_body"]) == len(PDF), len(dl["_body"]))
    check("nosniff 標頭在（nginx 要自己補）",
          headers.get("X-Content-Type-Options") == "nosniff", dict(headers))

    if viewer:
        listing = viewer.get(f"/attachments?target=project&id={pid}")
        cats = {a["category"] for a in listing.get("results", [])}
        check("檢視角色的清單看不到合約（金額型附件）", "contract" not in cats, cats)
        viewer.get(f"/attachments/{up['id']}/download", raw=True)
        check("檢視角色直接抓合約檔 → 擋下", viewer.status in (403, 404), viewer.status)

    # ── G. 進度補登 ────────────────────────────────────────────────
    print("\n▌G. 構件批次（七站）與自動彙總")
    unit = owner.post("/tracking-units", {
        "project": pid, "name": "驗收批次", "unit_type": "batch",
        "qty_total": "10", "unit_of_measure": "支",
    })
    check("經理能補登：建批次（鋼構七站模板自動帶入）",
          owner.status == 201 and unit.get("stage_total") == 7, f"{owner.status} {unit}")

    r = owner.post(f"/tracking-units/{unit['id']}/report-progress", {"delta": "4"})
    check("回報進度 +4", owner.status == 200 and r["unit"]["qty_done"] == "4.00", f"{owner.status} {r}")

    r = owner.post(f"/tracking-units/{unit['id']}/move-stage", {"direction": "forward"})
    check("推進一站，完成度歸零",
          owner.status == 200 and r["unit"]["stage_seq"] == 2 and r["unit"]["qty_done"] == "0.00", r)

    r = owner.post(f"/tracking-units/{unit['id']}/move-stage", {"direction": "backward"})
    check("退回不用選原因類別（辦公室補登，別攔）", owner.status == 200, f"{owner.status} {r}")

    # 批次過站 → 4.1（廠內加工）自動彙總。門檻：加工完成（第 3 站）
    fu = owner.get(f"/flow-units?project={pid}&q=廠內加工")
    u41 = next((u for u in fu.get("results", [])), {})
    check("批次建立後，4.1 分母＝批次數（1 批）",
          u41.get("qty_total") == "1.00" and u41.get("is_batch_driven"), u41)
    owner.post(f"/tracking-units/{unit['id']}/move-stage", {"direction": "forward"})
    owner.post(f"/tracking-units/{unit['id']}/move-stage", {"direction": "forward"})
    u41 = owner.get(f"/flow-units/{u41['id']}") if u41.get("id") else {}
    check("★ 批次走到「加工完成」→ 4.1 自動變已完成",
          u41.get("state") == "done" and u41.get("qty_done") == "1.00", u41)
    r = owner.post(f"/flow-units/{u41['id']}/report-progress", {"delta": "1"})
    check("批次彙總的單元不能手動回報（400）", owner.status == 400, f"{owner.status} {r}")

    # 工作項目：流程單元的內容物清單（2026-08-17）
    task = owner.post("/flow-tasks", {
        "unit": u41["id"], "name": "鐵材", "qty": "500", "unit_of_measure": "噸",
    })
    check("流程單元能新增工作項目", owner.status == 201 and task.get("status") == "未開始", task)
    r = owner.patch(f"/flow-tasks/{task['id']}", {"status": "已下訂單"})
    check("工作項目狀態可自訂文字", r.get("status") == "已下訂單", r)

    # 工作分配：每個項目自己的狀態清單＝工段，可把分量派給員工（D41/D45）
    r = owner.patch(f"/flow-tasks/{task['id']}", {"statuses": ["切割中"]})
    check("項目能維護自己的狀態清單", owner.status == 200
          and r.get("statuses") == ["切割中"], f"{owner.status} {r}")
    worker_id = next(u["id"] for u in users if u["name"] == "工廠員工1")
    assign = owner.post("/task-assignments", {
        "task": task["id"], "status": "切割中", "assignee": worker_id, "qty_assigned": "200",
    })
    check("分配工段給員工（對方收通知）", owner.status == 201, f"{owner.status} {assign}")
    worker = Client("worker01").login()
    r = worker.patch(f"/task-assignments/{assign['id']}", {"qty_done": "200"})
    check("員工回報做完自己的分量", worker.status == 200 and r.get("is_done"), f"{worker.status} {r}")
    t = owner.get(f"/flow-tasks/{task['id']}")
    check("總進度＝工段完成度平均（200/500 → 40%）", t.get("progress_pct") == 40.0,
          t.get("progress_pct"))

    owner.delete(f"/flow-tasks/{task['id']}")
    check("工作項目可刪除（分配一併刪除）", owner.status == 204, owner.status)

    # ── G2. D49：流程模板、自訂流程與重排、注意事項、現金餘額 ────────
    print("\n▌G2. D49（模板制／自訂流程／注意事項／現金餘額）")
    tpls = owner.get("/flow-templates")
    check("流程模板列表（有預設）", any(t.get("is_default") for t in tpls), tpls)
    default_tpl = next(t for t in tpls if t["is_default"])
    dup = owner.post(f"/flow-templates/{default_tpl['id']}/duplicate", {"name": "驗證用模板"})
    check("複製模板", owner.status == 201, owner.status)
    owner.delete(f"/flow-templates/{dup['id']}")
    check("刪除沒用過的模板", owner.status == 204, owner.status)

    stage2 = owner.get("/flow-catalog")[1]
    cu = owner.post(f"/projects/{pid}/add-flow", {"name": "驗證自訂流程", "stage": stage2["id"]})
    check("加自訂流程", owner.status == 201 and cu.get("is_custom") is True, owner.status)
    d = owner.get(f"/projects/{pid}")
    ids = [u["id"] for u in d["flow_units"]]
    ids.insert(0, ids.pop(ids.index(cu["id"])))
    r = owner.post(f"/projects/{pid}/reorder-flows", {"unit_ids": ids})
    check("案內拖移重排", owner.status == 200
          and r["project"]["flow_units"][0]["id"] == cu["id"], owner.status)
    owner.delete(f"/flow-units/{cu['id']}")
    check("刪自訂流程", owner.status == 204, owner.status)

    owner.get("/cashflow/cash-balance")
    check("經理看得到公司現有現金", owner.status == 200, owner.status)
    finance.get("/cashflow/cash-balance")
    check("會計師看不到公司現有現金", finance.status == 403, finance.status)

    # ── G3. D52（工作類型／回報計工／品項明細／統計）────────────────
    print("\n▌G3. D52（產能與成本統計）")
    wt = owner.post("/work-types", {"name": f"驗證類型{stamp}"})
    check("經理新增工作類型", owner.status == 201, owner.status)
    staff.post("/work-types", {"name": "員工不可"})
    check("員工不能新增工作類型", staff.status == 403, staff.status)
    owner.post("/task-assignments", {})
    check("分配缺工作類型會被擋（必選）", owner.status == 400, owner.status)
    owner.delete(f"/work-types/{wt['id']}")
    check("刪沒用過的工作類型", owner.status == 204, owner.status)

    item = finance.post("/material-items", {"name": f"驗證品項{stamp}", "unit_of_measure": "噸"})
    check("會計新增品項", finance.status == 201, finance.status)
    finance.delete(f"/material-items/{item['id']}")
    check("刪沒用過的品項", finance.status == 204, finance.status)

    owner.get("/stats/productivity")
    check("經理看產能統計", owner.status == 200, owner.status)
    finance.get("/stats/productivity")
    check("會計看不到產能統計", finance.status == 403, finance.status)
    finance.get("/stats/unit-prices")
    check("會計看得到單價統計", finance.status == 200, finance.status)
    staff.get("/stats/unit-prices")
    check("員工看不到單價統計", staff.status == 403, staff.status)
    finance.get("/stats/flow-costs")
    check("會計看得到流程花費統計", finance.status == 200, finance.status)

    # ── H. 儀表板 ──────────────────────────────────────────────────
    print("\n▌H. 儀表板")
    overview = owner.get("/dashboard/overview")
    keys = [c["key"] for c in overview.get("cards", [])]
    check("經營者看得到收款率卡片", "collection_rate" in keys, keys)
    attention = owner.get("/dashboard/attention")
    types = {i["type"] for i in attention.get("results", [])}
    check("需要關注：有「放著沒開單」的錢", "billing_overdue" in types, types)
    check("需要關注：有停滯提醒", "stalled" in types or "unit_status" in types, types)

    if viewer:
        v_over = viewer.get("/dashboard/overview")
        v_keys = [c["key"] for c in v_over.get("cards", [])]
        check("檢視角色的儀表板沒有錢的卡片", "collection_rate" not in v_keys, v_keys)

    # ── 清理 ───────────────────────────────────────────────────────
    print("\n▌清理")
    owner.delete(f"/tracking-units/{unit['id']}")
    r = owner.delete(f"/projects/{pid}")
    check("測試案清理", owner.status in (204, 400), owner.status)
    if owner.status == 400:  # 有已收款的列擋刪除也是正確行為
        check("（專案還有資料時拒絕刪除也是對的）", True)

    # ── 結果 ───────────────────────────────────────────────────────
    print(f"\n{'─' * 46}")
    print(f"通過 {len(PASS)}　失敗 {len(FAIL)}")
    if FAIL:
        print("失敗項目：")
        for name in FAIL:
            print(f"  ✘ {name}")
        sys.exit(1)
    print("全部通過")


if __name__ == "__main__":
    main()
