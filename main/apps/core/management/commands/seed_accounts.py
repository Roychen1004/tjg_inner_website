"""
建立 admin 超級使用者與 11 個測試角色帳號

冪等 —— 可重複執行。已存在的帳號只更新姓名與角色，不覆寫密碼。
密碼由 .env 的 DJANGO_SUPERUSER_PASSWORD / SEED_DEMO_PASSWORD 提供。

⚠️ 測試角色帳號是為了驗收「不同角色看到不同畫面」而建，
正式上線前應刪除或改成真實員工帳號（見帳號檔「⑦ 上線前必改」）。
"""
import os

from django.contrib.auth.models import Group
from django.core.management.base import BaseCommand
from django.db import transaction

from main.apps.core.models import Department, Role, User

DEPARTMENTS = [
    ("MGT", "經營管理部", None),
    ("PM", "工程部", None),
    ("PLANT", "生產部", None),
    ("SITE", "工務部", None),
    ("PUR", "採購部", None),
    ("QC", "品保部", None),
    ("WH", "倉儲部", None),
    ("FIN", "財務部", None),
    ("HR", "管理部", None),
]

# username, 姓名, 員工編號, 職稱, 部門代號, 角色
DEMO_USERS = [
    ("owner", "王董", "E001", "總經理", "MGT", [Role.OWNER]),
    ("pm", "王志明", "E002", "專案經理", "PM", [Role.PM]),
    ("plant", "李廠長", "E003", "廠長", "PLANT", [Role.PLANT_MGR]),
    ("site", "陳主任", "E004", "工地主任", "SITE", [Role.SITE_MGR]),
    ("purchase", "林採購", "E005", "採購專員", "PUR", [Role.PURCHASER]),
    ("qc", "黃品保", "E006", "品保工程師", "QC", [Role.QC]),
    ("wh", "張倉管", "E007", "倉管", "WH", [Role.WAREHOUSE]),
    ("finance", "劉會計", "E008", "會計主任", "FIN", [Role.FINANCE]),
    ("hr", "吳人資", "E009", "人資專員", "HR", [Role.HR]),
    ("worker", "陳師傅", "E010", "焊接技師", "PLANT", [Role.WORKER]),
]


class Command(BaseCommand):
    help = "建立 admin 與 11 個測試角色帳號（冪等）"

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset-passwords", action="store_true",
            help="連同已存在的帳號一起重設密碼",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        reset = options["reset_passwords"]
        admin_pw = os.environ.get("DJANGO_SUPERUSER_PASSWORD", "")
        demo_pw = os.environ.get("SEED_DEMO_PASSWORD", admin_pw)

        if not admin_pw:
            self.stderr.write(self.style.ERROR(
                "缺少 DJANGO_SUPERUSER_PASSWORD 環境變數。請確認 deploy/.env 已填寫密碼。"
            ))
            return

        self.stdout.write(self.style.MIGRATE_HEADING("建立帳號"))

        if not Group.objects.exists():
            self.stderr.write(self.style.WARNING(
                "尚未建立角色群組。請先執行：python manage.py seed_masters"
            ))
            return

        self._seed_departments()
        self._seed_admin(admin_pw, reset)
        self._seed_demo_users(demo_pw, reset)

        self.stdout.write(self.style.SUCCESS("\n✔ 帳號建立完成"))
        self.stdout.write(
            "\n⚠️ 測試角色帳號僅供驗收使用，正式上線前請刪除或改為真實員工帳號"
        )

    def _seed_departments(self):
        self.stdout.write("\n▸ 部門")
        for i, (code, name, parent_code) in enumerate(DEPARTMENTS):
            parent = Department.objects.filter(code=parent_code).first() if parent_code else None
            Department.objects.update_or_create(
                code=code, defaults={"name": name, "parent": parent, "sort_order": i},
            )
        self.stdout.write(f"    共 {len(DEPARTMENTS)} 個部門")

    def _seed_admin(self, password, reset):
        self.stdout.write("\n▸ 系統管理員")
        email = os.environ.get("DJANGO_SUPERUSER_EMAIL", "")
        user, is_new = User.objects.get_or_create(
            username="admin",
            defaults={
                "name": "系統管理員",
                "email": email,
                "is_staff": True,
                "is_superuser": True,
                "must_change_password": False,
            },
        )
        if is_new or reset:
            user.set_password(password)
        user.is_staff = user.is_superuser = True
        user.save()
        user.groups.set(Group.objects.filter(name=Role.ADMIN))
        state = "新增" if is_new else ("已存在，密碼已重設" if reset else "已存在，密碼不變")
        self.stdout.write(f"    admin　{state}")

    def _seed_demo_users(self, password, reset):
        self.stdout.write("\n▸ 測試角色帳號")
        for username, name, emp_no, title, dept_code, roles in DEMO_USERS:
            dept = Department.objects.filter(code=dept_code).first()
            user, is_new = User.objects.get_or_create(
                username=username,
                defaults={
                    "name": name,
                    "employee_no": emp_no,
                    "title": title,
                    "department": dept,
                    "must_change_password": False,
                },
            )
            if is_new or reset:
                user.set_password(password)
            user.name, user.employee_no, user.title, user.department = name, emp_no, title, dept
            user.must_change_password = False
            user.save()
            user.groups.set(Group.objects.filter(name__in=[str(r) for r in roles]))

            role_label = "、".join(dict(Role.choices)[r] for r in roles)
            home = "我的工作" if user.default_route == "/my-work" else "營運總覽"
            mark = "＋" if is_new else "·"
            self.stdout.write(f"    {mark} {username:<10} {name:<5} {role_label:<12} → {home}")
        self.stdout.write(f"    共 {len(DEMO_USERS)} 個帳號")
