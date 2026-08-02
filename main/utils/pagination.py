"""
分頁

依 API 規格 §3.1：page_size 硬上限 100，
**沒有「取得全部」的選項**——這是 8GB 主機的硬規則（決策 D07）。
需要完整清單時（如下拉選單），用專用的精簡端點只回 id + name。
"""
from rest_framework.pagination import PageNumberPagination


class StandardPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 100


class SmallPagination(StandardPagination):
    """給「我的工作」這種一定很短的清單用"""

    page_size = 50
    max_page_size = 50
