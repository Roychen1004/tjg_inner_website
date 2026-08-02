"""依 django_rules.md：models 一張表一個 .py 檔，由此匯出"""
from .asset_unit import AssetMovement, AssetUnit

__all__ = ["AssetMovement", "AssetUnit"]
