from rest_framework import serializers

from main.apps.core.models import Department, User
from main.utils.permissions import permission_map, visible_nav


class DepartmentBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Department
        fields = ["id", "code", "name"]


class UserBriefSerializer(serializers.ModelSerializer):
    """指派選單、負責人顯示等處使用的精簡版"""

    class Meta:
        model = User
        fields = ["id", "name", "employee_no", "title"]


class CurrentUserSerializer(serializers.ModelSerializer):
    """GET /auth/me 與登入成功時回傳。

    一次給齊前端需要的東西：角色、功能權限、可見導航、預設首頁——
    前端不必再寫一次「哪個角色能做什麼」的邏輯。
    """

    department = DepartmentBriefSerializer(read_only=True)
    roles = serializers.SerializerMethodField()
    role_labels = serializers.SerializerMethodField()
    permissions = serializers.SerializerMethodField()
    visible_nav = serializers.SerializerMethodField()
    owned_project_ids = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id", "username", "employee_no", "name", "title", "phone", "email",
            "department", "roles", "role_labels", "permissions", "visible_nav",
            "owned_project_ids", "must_change_password", "default_route", "is_superuser",
        ]

    def get_roles(self, obj) -> list[str]:
        return sorted(obj.role_codes)

    def get_role_labels(self, obj) -> list[str]:
        from main.apps.core.models import Role

        labels = dict(Role.choices)
        return [labels.get(c, c) for c in sorted(obj.role_codes)]

    def get_permissions(self, obj) -> dict[str, bool]:
        return permission_map(obj)

    def get_visible_nav(self, obj) -> list[str]:
        return visible_nav(obj)

    def get_owned_project_ids(self, obj) -> list[int]:
        return list(obj.owned_projects.values_list("pk", flat=True))


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField(label="帳號", max_length=50)
    password = serializers.CharField(label="密碼", write_only=True, style={"input_type": "password"})


class ChangePasswordSerializer(serializers.Serializer):
    old_password = serializers.CharField(label="舊密碼", write_only=True)
    new_password = serializers.CharField(label="新密碼", write_only=True, min_length=8)
    confirm_password = serializers.CharField(label="確認新密碼", write_only=True)

    def validate(self, attrs):
        if attrs["new_password"] != attrs["confirm_password"]:
            raise serializers.ValidationError({"confirm_password": "兩次輸入的新密碼不一致"})
        if attrs["new_password"] == attrs["old_password"]:
            raise serializers.ValidationError({"new_password": "新密碼不可與舊密碼相同"})
        return attrs
