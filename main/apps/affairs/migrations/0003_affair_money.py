"""D55：行政事項也可以記金額（收/支）——進「金流 → 收支明細」與現金流預測"""

from decimal import Decimal
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('affairs', '0002_default_categories'),
    ]

    operations = [
        migrations.AddField(
            model_name='affairrule',
            name='amount',
            field=models.DecimalField(decimal_places=2, default=Decimal('0'), help_text='每一次要收或要付多少（稅後）。0＝不涉及金錢，不進金流', max_digits=14, verbose_name='金額'),
        ),
        migrations.AddField(
            model_name='affairrule',
            name='direction',
            field=models.CharField(choices=[('in', '收入'), ('out', '支出')], default='out', max_length=3, verbose_name='收支'),
        ),
        migrations.AddField(
            model_name='affairtask',
            name='amount',
            field=models.DecimalField(decimal_places=2, default=Decimal('0'), help_text='這一次要收或要付多少（稅後）。0＝不涉及金錢，不進金流', max_digits=14, verbose_name='金額'),
        ),
        migrations.AddField(
            model_name='affairtask',
            name='direction',
            field=models.CharField(choices=[('in', '收入'), ('out', '支出')], default='out', max_length=3, verbose_name='收支'),
        ),
    ]
