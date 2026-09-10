"""從政府資料開放平臺匯入辦公日曆表（D57 第四輪）

資料來源：政府資料開放平臺 dataset 14718「中華民國政府行政機關辦公日曆表」，
原始資料是行政院人事行政總處公告的 CSV，一年一個檔。

CSV 欄位：西元日期,星期,是否放假,備註
    是否放假：2＝放假、0＝上班
    備註：假日名稱（一般的週六週日是空的）

只匯入「**跟預設規則不一樣**」的日子：
    平日卻放假 → 國定假日（會讓應上班天數變少）
    週末卻上班 → 補班日（會讓應上班天數變多）
一般的平日上班、週末放假不必記——預設規則就是那樣，記了只是讓表變大。

⚠️ 這支要連外網。正式機在區網裡可能連不出去，所以匯入是**手動按的**，
   不是排程；失敗時把原因講清楚，會計師仍然可以在畫面上一筆一筆自己加。
"""
import csv
import datetime as dt
import io
import json
import urllib.error
import urllib.request

DATASET_API = "https://data.gov.tw/api/v2/rest/dataset/14718"
TIMEOUT = 30
HOLIDAY_FLAG = "2"          # 是否放假：2＝放假
WEEKEND = (5, 6)            # weekday()：5＝週六、6＝週日


class CalendarImportError(Exception):
    """匯入失敗，訊息是要直接顯示給會計師看的人話"""


def _fetch(url, *, as_text=False):
    request = urllib.request.Request(url, headers={"User-Agent": "tjg-inner/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            raw = response.read()
    except urllib.error.HTTPError as exc:
        raise CalendarImportError(
            f"下載失敗（HTTP {exc.code}）。政府網站可能改版了，"
            "請改用下方的「自己加一天」把假日補上。"
        ) from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise CalendarImportError(
            "連不到政府資料開放平臺。這台機器可能沒有對外網路——"
            "請改用下方的「自己加一天」把假日補上。"
        ) from exc
    if as_text:
        # 政府的 CSV 是 UTF-8 with BOM
        return raw.decode("utf-8-sig", errors="replace")
    return raw


def find_csv_url(year: int) -> str:
    """在資料集裡找某一年的 CSV 網址。

    每年的檔案網址都不一樣（是一串 uuid），所以不能寫死，
    要每次去資料集清單裡找——這也是為什麼要走開放平臺的 API 而不是直連檔案。
    """
    roc_year = year - 1911
    payload = json.loads(_fetch(DATASET_API, as_text=True))
    resources = (payload.get("result") or {}).get("distribution") or []

    candidates = [
        r for r in resources
        if f"{roc_year}年" in (r.get("resourceDescription") or "")
        # Google 行事曆版的欄位不一樣，不要抓錯
        and "Google" not in (r.get("resourceDescription") or "")
        and (r.get("resourceDownloadUrl") or "")
    ]
    if not candidates:
        raise CalendarImportError(
            f"政府資料開放平臺上還沒有民國 {roc_year} 年（西元 {year}）的辦公日曆表。"
            "通常前一年的年中才會公告。"
        )
    # 有「更新版」時取最後一筆——清單是照發布順序排的
    return candidates[-1]["resourceDownloadUrl"]


def parse_csv(text: str, year: int):
    """把 CSV 轉成 [(date, name, is_workday)]，只留跟預設規則不同的日子"""
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows:
        raise CalendarImportError("下載到的檔案是空的，請稍後再試")

    date_key = next((k for k in rows[0] if k and "日期" in k), None)
    flag_key = next((k for k in rows[0] if k and "放假" in k), None)
    note_key = next((k for k in rows[0] if k and "備註" in k), None)
    if not date_key or not flag_key:
        raise CalendarImportError(
            f"檔案格式跟預期不一樣（欄位：{'、'.join(k for k in rows[0] if k)}）。"
            "政府可能改了格式，請改用手動新增。"
        )

    out = []
    for row in rows:
        raw = (row.get(date_key) or "").strip()
        if len(raw) != 8 or not raw.isdigit():
            continue
        date = dt.date(int(raw[:4]), int(raw[4:6]), int(raw[6:8]))
        if date.year != year:
            continue
        is_off = (row.get(flag_key) or "").strip() == HOLIDAY_FLAG
        name = (row.get(note_key) or "").strip() if note_key else ""
        weekend = date.weekday() in WEEKEND

        if is_off and not weekend:
            # 平日放假＝國定假日或補假
            out.append((date, name or "放假", False))
        elif not is_off and weekend:
            # 週末上班＝補班日
            out.append((date, name or "補行上班", True))
        # 其餘（平日上班、週末放假）跟預設規則一樣，不必記
    return out


def import_year(year: int):
    """下載並寫入某一年的假日。回傳 (新增, 更新, 來源網址)。

    冪等：已經有的那天只更新名稱與是否上班，不會重複建立。
    使用者自己加的日子若政府檔案裡也有，以政府的為準。
    """
    from main.apps.payroll.models import Holiday

    url = find_csv_url(year)
    days = parse_csv(_fetch(url, as_text=True), year)
    if not days:
        raise CalendarImportError(
            f"{year} 年的檔案裡沒有解析到任何假日，請確認來源檔案"
        )

    created = updated = 0
    for date, name, is_workday in days:
        _, is_new = Holiday.objects.update_or_create(
            date=date, defaults={"name": name, "is_workday": is_workday},
        )
        created, updated = (created + 1, updated) if is_new else (created, updated + 1)
    return created, updated, url
