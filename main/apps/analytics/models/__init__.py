"""依 django_rules.md：models 一張表一個 .py 檔，由此匯出"""
from .kpi_snapshot import KpiSnapshot

__all__ = ["KpiSnapshot"]
