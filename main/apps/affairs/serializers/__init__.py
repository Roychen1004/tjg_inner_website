import re

from rest_framework import serializers

from main.apps.affairs.models import AffairCategory, AffairRule, AffairTask
from main.apps.core.models import User
from main.utils.choices import AffairFreq


class AffairCategorySerializer(serializers.ModelSerializer):
    # 拿掉欄位自帶的 unique 驗證器——它會搶在 validate_name 前面丟出
    # 「包含 名稱 的 行政類別 已經存在。」這種話。重名要講的是「該怎麼辦」
    name = serializers.CharField(max_length=50, validators=[])

    class Meta:
        model = AffairCategory
        fields = ["id", "name", "color", "is_active"]

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("請填寫類別名稱，如「繳費」")
        # D56 起表單裡就能新增類別，撞名是常態；unique 的英文錯誤訊息看不懂，
        # 這裡直接講清楚該怎麼辦（尤其停用中的那種——它不在下拉裡，找不到人會一直重建）
        clash = AffairCategory.objects.filter(name__iexact=value)
        if self.instance:
            clash = clash.exclude(pk=self.instance.pk)
        if existing := clash.first():
            raise serializers.ValidationError(
                f"已經有「{existing.name}」這個類別了"
                + ("，直接在下拉選它就好" if existing.is_active
                   else "（目前停用中），到「類別」裡按啟用就會回到下拉")
            )
        return value

    def validate_color(self, value):
        if value and not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
            raise serializers.ValidationError("顏色格式須為 #RRGGBB")
        return value


class AffairTaskSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source="category.name", read_only=True)
    category_color = serializers.CharField(source="category.color", read_only=True)
    direction_label = serializers.CharField(source="get_direction_display", read_only=True)
    assignees = serializers.PrimaryKeyRelatedField(many=True, read_only=True)
    assignee_names = serializers.SerializerMethodField()
    done_by_name = serializers.CharField(source="done_by.name", read_only=True, default=None)
    is_overdue = serializers.SerializerMethodField()
    rule_text = serializers.SerializerMethodField()

    class Meta:
        model = AffairTask
        fields = [
            "id", "rule", "rule_text", "title",
            "category", "category_name", "category_color",
            "date", "note", "amount", "direction", "direction_label", "is_reference",
            "assignees", "assignee_names",
            "is_done", "done_by", "done_by_name", "done_at", "is_overdue",
        ]

    def get_assignee_names(self, obj):
        return [u.name for u in obj.assignees.all()]

    def get_is_overdue(self, obj):
        return obj.is_overdue

    def get_rule_text(self, obj):
        return obj.rule.freq_text if obj.rule else ""


class AmountMixin:
    """金額不能是負數——方向由 direction 表示，用負數會變成兩套規則（D55）"""

    def validate_amount(self, value):
        if value is not None and value < 0:
            raise serializers.ValidationError("金額不能是負數；要記支出請把「收支」選成支出")
        return value


class AffairTaskWriteSerializer(AmountMixin, serializers.ModelSerializer):
    assignees = serializers.PrimaryKeyRelatedField(
        many=True, required=False, queryset=User.objects.filter(is_active=True),
    )

    class Meta:
        model = AffairTask
        fields = [
            "title", "category", "date", "note",
            "amount", "direction", "is_reference", "assignees",
        ]

    def validate_title(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("請填寫事項標題，如「繳公司網路費」")
        return value


class AffairRuleSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source="category.name", read_only=True)
    category_color = serializers.CharField(source="category.color", read_only=True)
    freq_label = serializers.CharField(source="get_freq_display", read_only=True)
    direction_label = serializers.CharField(source="get_direction_display", read_only=True)
    freq_text = serializers.CharField(read_only=True)
    assignees = serializers.PrimaryKeyRelatedField(many=True, read_only=True)
    assignee_names = serializers.SerializerMethodField()

    class Meta:
        model = AffairRule
        fields = [
            "id", "title", "category", "category_name", "category_color", "note",
            "amount", "direction", "direction_label", "is_reference",
            "freq", "freq_label", "freq_text",
            "weekdays", "month_day", "year_month", "year_day",
            "start_date", "end_date",
            "assignees", "assignee_names", "is_active",
        ]

    def get_assignee_names(self, obj):
        return [u.name for u in obj.assignees.all()]


class AffairRuleWriteSerializer(AmountMixin, serializers.ModelSerializer):
    assignees = serializers.PrimaryKeyRelatedField(
        many=True, required=False, queryset=User.objects.filter(is_active=True),
    )

    class Meta:
        model = AffairRule
        fields = [
            "title", "category", "note", "amount", "direction", "is_reference",
            "freq", "weekdays", "month_day", "year_month", "year_day",
            "start_date", "end_date", "assignees", "is_active",
        ]

    def validate_title(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("請填寫事項標題，如「打掃辦公室」")
        return value

    def validate(self, data):
        # PATCH 時沒帶的欄位沿用原值一起驗，規則不會被改成半套
        def val(name):
            if name in data:
                return data[name]
            return getattr(self.instance, name, None) if self.instance else None

        freq = val("freq")
        if freq == AffairFreq.WEEKLY:
            weekdays = val("weekdays") or []
            if not weekdays or not all(
                isinstance(d, int) and 0 <= d <= 6 for d in weekdays
            ):
                raise serializers.ValidationError({"weekdays": "每週的規則請至少勾一天（0=週一 … 6=週日）"})
        elif freq == AffairFreq.MONTHLY:
            if not val("month_day") or not 1 <= val("month_day") <= 31:
                raise serializers.ValidationError({"month_day": "每月的規則請填 1–31 的日期"})
        elif freq == AffairFreq.YEARLY:
            if not val("year_month") or not 1 <= val("year_month") <= 12:
                raise serializers.ValidationError({"year_month": "每年的規則請填 1–12 的月份"})
            if not val("year_day") or not 1 <= val("year_day") <= 31:
                raise serializers.ValidationError({"year_day": "每年的規則請填 1–31 的日期"})

        start, end = val("start_date"), val("end_date")
        if start and end and end < start:
            raise serializers.ValidationError({"end_date": "結束日不能早於起始日"})
        return data
