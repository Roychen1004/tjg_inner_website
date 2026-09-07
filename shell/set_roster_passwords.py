#!/usr/bin/env python3
"""
把 docs/帳號密碼.md 的名冊密碼寫進資料庫。

為什麼需要這支：
    `manage.py seed_accounts` 只吃 DJANGO_SUPERUSER_PASSWORD 與
    **一組** SEED_DEMO_PASSWORD——它表達不出「一人一組密碼」。
    但 docs/帳號密碼.md 是一人一組，而且 shell/verify.py 驗收時
    是照那份表登入的。新機器只跑 seed_accounts 的話，
    verify.py 會在登入那一步就掛掉，而且看起來像權限問題。

    所以名冊密碼的唯一事實來源是那份 markdown，這支只負責套用。
    改密碼：改 docs/帳號密碼.md 的表格，再跑一次這支。

用法（在宿主機，系統要先啟動）：
    python3 shell/set_roster_passwords.py          # 套用
    python3 shell/set_roster_passwords.py --dry-run # 只看會改哪些帳號
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ROSTER = ROOT / "docs" / "帳號密碼.md"

# | 帳號 | 姓名 | 角色 | 密碼 |  ——只認四欄、帳號是純英數的那幾列
ROW = re.compile(r"^\|\s*([A-Za-z][A-Za-z0-9_]*)\s*\|[^|]*\|[^|]*\|\s*(\S+)\s*\|")


def parse_roster(text):
    return {m.group(1): m.group(2) for line in text.splitlines() if (m := ROW.match(line))}


def main():
    dry_run = "--dry-run" in sys.argv
    if not ROSTER.exists():
        sys.exit(f"找不到名冊：{ROSTER}")

    table = parse_roster(ROSTER.read_text(encoding="utf-8"))
    if not table:
        sys.exit(f"{ROSTER.name} 裡沒有解析到任何帳號——表格格式是不是改了？")

    print(f"從 {ROSTER.name} 讀到 {len(table)} 個帳號：{'、'.join(table)}")
    if dry_run:
        return

    # 密碼從 stdin 進容器，不落在 docker exec 的命令列上（ps 看得到）
    snippet = (
        "from main.apps.core.models import User\n"
        f"TABLE = {table!r}\n"
        "missing = []\n"
        "for username, pw in TABLE.items():\n"
        "    u = User.objects.filter(username=username).first()\n"
        "    if not u:\n"
        "        missing.append(username); continue\n"
        "    u.set_password(pw); u.save(update_fields=['password'])\n"
        "print(f'已設定 {len(TABLE) - len(missing)} 個帳號的密碼')\n"
        "if missing: print('找不到的帳號：', missing)\n"
    )
    proc = subprocess.run(
        ["docker", "compose", "exec", "-T", "api", "python", "manage.py", "shell"],
        input=snippet, text=True, cwd=ROOT, capture_output=True,
    )
    # Django 啟動時 axes 會噴一行 INFO，不是錯誤
    for line in (proc.stdout + proc.stderr).splitlines():
        if "AXES:" not in line and line.strip():
            print(line)
    sys.exit(proc.returncode)


if __name__ == "__main__":
    main()
