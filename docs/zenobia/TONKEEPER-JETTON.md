# توثيق عملة ZNB في Tonkeeper (تخرج من «غير موثّقة»)

بحسب صفحة Tonkeeper الرسمية (https://tonkeeper.helpscoutdocs.com/article/127-tokennftverification): التوثيق مجاني، ويتم بطلب Pull Request إلى https://github.com/tonkeeper/ton-assets بتعديل ملفات yaml في المجلد `jettons/` فقط (لا يُعدَّل أي ملف json مولَّد)، ولهم حق الرفض دون تفسير. **لا يملكون معايير منشورة للسيولة أو عدد الحاملين**، وعملتنا جديدة (حاملان فقط)، فالقبول غير مضمون وقد يتأخر حتى تكبر.

لا أستطيع إرسال الطلب: يحتاج حساب GitHub باسمك. الخطوات (ثلاث دقائق):
1. افتح https://github.com/tonkeeper/ton-assets ثم **Fork**.
2. في مجلد `jettons/` أضف ملف `Zenobia.yaml` (قارن أسماء الحقول بأي ملف موجود في المجلد نفسه قبل الإرسال، فلم أتحقق من القالب الحالي):
```yaml
name: Zenobia
address: EQDai9iDv4fDlQHUDxx59QUZMGvTm9uzUL867c_Lxi4cDuCN
symbol: ZNB
decimals: 9
image: https://ttbik.vercel.app/zenobia/coin-icon.png
description: Zenobia (ZNB) is a community coin inspired by Zenobia, queen of Palmyra, and the Silk Road, launched on Blum Memepad.
websites:
  - https://ttbik.vercel.app/zenobia/hall.html
social:
  - https://t.me/Zenobiaton
  - https://t.me/Zenobia_Palmyrabot
```
3. افتح **Pull Request** بعنوان `Add Zenobia (ZNB) jetton`، وفي الوصف: عنوان العقد، وأنه أُطلق عبر Blum Memepad (عقد قالب لا إدارة له)، وروابط القناة والموقع، ورابط المعاملة على المستكشف.

ما سيطلبونه غالبًا ويحسن تجهيزه: إثبات الملكية (أنك أنشأتها من محفظتك: المعاملة الأولى على https://tonviewer.com/EQDai9iDv4fDlQHUDxx59QUZMGvTm9uzUL867c_Lxi4cDuCN )، وموقع أو قناة نشطة، وسيولة على منصة (تأتي بعد الإدراج على STON.fi عند بلوغ 1,500 TON).
