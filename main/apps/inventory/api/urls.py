"""
庫存的讀取端點掛在 assets 模組底下（/lots、/locations）——
使用者心裡沒有「庫存」與「資產」兩個系統，只有「公司有什麼東西」一個問題。
"""
from django.urls import path  # noqa: F401

app_name = "inventory"

urlpatterns = []
