"""D56：行政事項的金額可以標成「參考」——預估的錢，只顯示不進金流"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('affairs', '0003_affair_money'),
    ]

    operations = [
        migrations.AddField(
            model_name='affairrule',
            name='is_reference',
            field=models.BooleanField(default=False, help_text='打勾＝預估金額，只顯示不計入公司的收入與支出', verbose_name='只是參考'),
        ),
        migrations.AddField(
            model_name='affairtask',
            name='is_reference',
            field=models.BooleanField(default=False, help_text='打勾＝預估金額，只顯示不計入公司的收入與支出', verbose_name='只是參考'),
        ),
    ]
