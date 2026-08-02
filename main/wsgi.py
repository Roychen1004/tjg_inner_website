"""WSGI config for 鐵正綱工程 內部管理系統."""
import os

from django.core.wsgi import get_wsgi_application
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "deploy", ".env"))

os.environ.setdefault(
    "DJANGO_SETTINGS_MODULE",
    os.environ.get("DJANGO_SETTINGS_MODULE", "main.settings.production"),
)

application = get_wsgi_application()
