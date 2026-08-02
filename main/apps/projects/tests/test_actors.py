"""依 django_rules.md：一個 actor 一個 class，命名 Test<Actor.name>"""
from django.test import TestCase


class TestPlaceholder(TestCase):
    def test_placeholder(self):
        self.assertTrue(True)
