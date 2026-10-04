"use client";
// Languages: the app opens in the user's Telegram language (initDataUnsafe.user.language_code),
// falls back to the browser language, and the user can switch (the choice is remembered).
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type Lang = "ar" | "en" | "ru" | "tr" | "fa";
export const LANGS: { code: Lang; name: string; rtl: boolean; locale: string }[] = [
  { code: "ar", name: "العربية", rtl: true, locale: "ar" },
  { code: "en", name: "English", rtl: false, locale: "en" },
  { code: "ru", name: "Русский", rtl: false, locale: "ru" },
  { code: "tr", name: "Türkçe", rtl: false, locale: "tr" },
  { code: "fa", name: "فارسی", rtl: true, locale: "fa" },
];
type Row = Record<Lang, string>;
const r = (ar: string, en: string, ru: string, tr: string, fa: string): Row => ({ ar, en, ru, tr, fa });

export const DICT = {
  "nav.home": r("الرئيسية", "Home", "Главная", "Ana sayfa", "خانه"),
  "nav.find": r("ابحث", "Find", "Поиск", "Ara", "جستجو"),
  "nav.mystery": r("الغموض", "Mystery", "Мистери", "Gizem", "اسرار"),
  "nav.auctions": r("المزادات", "Auctions", "Аукционы", "Müzayede", "حراج"),
  "nav.mine": r("رموزي", "Mine", "Мои", "Benim", "من"),
  "brand.by": r("من شام AI", "by Sham AI", "от Sham AI", "Sham AI'dan", "از Sham AI"),

  "tier.0": r("عادي", "Common", "Обычная", "Sıradan", "معمولی"),
  "tier.1": r("نادر", "Rare", "Редкая", "Nadir", "کمیاب"),
  "tier.2": r("أسطوري", "Mythic", "Мифическая", "Efsanevi", "اسطوره‌ای"),
  "stage.0": r("جديد", "New", "Новый", "Yeni", "نو"),
  "stage.1": r("ناضج", "Mature", "Зрелый", "Olgun", "پخته"),
  "stage.2": r("عتيق", "Aged", "Выдержанный", "Eskimiş", "کهنه"),
  "stage.3": r("قديم", "Old", "Старый", "Eski", "قدیمی"),
  "stage.4": r("تاريخي", "Historic", "Исторический", "Tarihî", "تاریخی"),

  "ui.cancelled": r("لم تكتمل العملية (أُلغيت أو رُفضت من المحفظة).", "The action was not completed (cancelled or rejected in the wallet).", "Действие не завершено (отменено или отклонено в кошельке).", "İşlem tamamlanmadı (cüzdanda iptal edildi veya reddedildi).", "عملیات کامل نشد (در کیف پول لغو یا رد شد)."),
  "ui.sent": r("تم الإرسال. سيظهر الأثر خلال لحظات.", "Sent. Your mark will appear in moments.", "Отправлено. Ваш след появится через несколько секунд.", "Gönderildi. İzin birkaç saniye içinde görünecek.", "ارسال شد. ردّ شما تا لحظاتی دیگر نمایان می‌شود."),
  "ui.ton": r("TON", "TON", "TON", "TON", "TON"),

  "home.title": r("لكل يوم أثر. واليوم الذي يخصّك لك وحدك.", "Every day leaves a trace. Your day can be yours alone.", "У каждого дня есть след. Ваш день может принадлежать только вам.", "Her günün bir izi var. Sana ait gün yalnızca senin olabilir.", "هر روز ردّی دارد. روزِ شما می‌تواند فقط مال شما باشد."),
  "home.sub": r("رمز واحد فقط لكل تاريخ بين 1950 و2049. يحفظ من امتلكه وما كتبوه، ويكبر شكله كلما احتُفظ به.", "One token for each date between 1950 and 2049. It remembers everyone who owned it and what they wrote, and it matures the longer it is held.", "Один токен на каждую дату с 1950 по 2049 год. Он помнит всех владельцев и то, что они написали, и взрослеет, чем дольше его хранят.", "1950 ile 2049 arasındaki her tarih için tek bir token. Sahiplerini ve yazdıklarını hatırlar; ne kadar uzun tutulursa o kadar olgunlaşır.", "برای هر تاریخ بین ۱۹۵۰ تا ۲۰۴۹ فقط یک توکن. همهٔ مالکان و نوشته‌هایشان را به یاد می‌سپارد و هرچه بیشتر نگه داشته شود پخته‌تر می‌شود."),
  "home.cta": r("ابحث عن تاريخك", "Find your date", "Найти свою дату", "Tarihini bul", "تاریخ خود را پیدا کنید"),
  "home.season": r("الموسم الأول", "Season 1", "Сезон 1", "1. Sezon", "فصل اول"),
  "home.open": r("مفتوح الآن", "Open now", "Открыто", "Açık", "باز است"),
  "home.soon": r("قريباً", "Soon", "Скоро", "Yakında", "به‌زودی"),
  "home.size": r("{n} تاريخاً في هذا الموسم", "{n} dates in this season", "{n} дат в этом сезоне", "Bu sezonda {n} tarih", "{n} تاریخ در این فصل"),
  "home.minted": r("مُصكوك", "Minted", "Выпущено", "Basıldı", "ضرب‌شده"),
  "home.pcommon": r("سعر العادي الآن", "Common price now", "Цена обычной сейчас", "Sıradan fiyat", "قیمت معمولی اکنون"),
  "home.prare": r("سعر النادر الآن", "Rare price now", "Цена редкой сейчас", "Nadir fiyat", "قیمت کمیاب اکنون"),
  "home.pnote": r("الأسعار تتحرك وحدها: ترتفع مع كل عملية شراء وتنخفض عندما يهدأ الطلب. اشترِ مبكراً.", "Prices move on their own: they rise with every purchase and fall when demand cools. Buy early.", "Цены меняются сами: растут с каждой покупкой и падают, когда спрос стихает. Покупайте раньше.", "Fiyatlar kendiliğinden hareket eder: her alımda yükselir, talep azalınca düşer. Erken al.", "قیمت‌ها خودکار تغییر می‌کنند: با هر خرید بالا می‌روند و وقتی تقاضا کم شود پایین می‌آیند. زود بخرید."),
  "home.how": r("كيف يعمل؟", "How it works", "Как это работает", "Nasıl çalışır?", "چگونه کار می‌کند؟"),
  "home.s1t": r("اختر تاريخك", "Pick your date", "Выберите дату", "Tarihini seç", "تاریخ خود را انتخاب کنید"),
  "home.s1d": r("ميلادك، زواجك، أو يوم تحبه.", "Your birthday, your wedding, or a day you love.", "День рождения, свадьба или любимый день.", "Doğum günün, evlilik günün ya da sevdiğin bir gün.", "تولد، ازدواج یا روزی که دوستش دارید."),
  "home.s2t": r("اصنع أثرك", "Make your mark", "Оставьте свой след", "İzini bırak", "ردّ خود را بسازید"),
  "home.s2d": r("تدفع من محفظتك مباشرة. لا حساب ولا وسيط.", "You pay straight from your wallet. No account, no middleman.", "Платите прямо из кошелька. Без аккаунта и посредников.", "Doğrudan cüzdanından ödersin. Hesap yok, aracı yok.", "مستقیم از کیف پول خود می‌پردازید. بدون حساب و واسطه."),
  "home.s3t": r("اكتب ذاكرتك", "Write your memory", "Запишите воспоминание", "Anını yaz", "خاطره‌تان را بنویسید"),
  "home.s3d": r("انقش سطراً يبقى مع الرمز للأبد، ومن بعدك يقرؤه.", "Engrave a line that stays with the token forever, for the next owner to read.", "Выгравируйте строку, которая останется с токеном навсегда — следующий владелец прочтёт её.", "Token ile sonsuza dek kalacak bir satır kazı; sonraki sahibi okur.", "سطری حک کنید که برای همیشه با توکن بماند و مالک بعدی آن را بخواند."),
  "home.why": r("ما الذي يجعله مختلفاً؟", "What makes it different?", "Чем это отличается?", "Onu farklı kılan ne?", "چه چیزی آن را متفاوت می‌کند؟"),
  "home.w1h": r("ذاكرة", "Memory", "Память", "Hafıza", "حافظه"),
  "home.w1d": r("كل من امتلك الرمز يترك فيه أثراً مكتوباً.", "Every owner leaves a written trace in it.", "Каждый владелец оставляет в нём письменный след.", "Her sahip içine yazılı bir iz bırakır.", "هر مالک ردّی نوشته‌شده در آن می‌گذارد."),
  "home.w2h": r("ينضج", "It matures", "Он взрослеет", "Olgunlaşır", "پخته می‌شود"),
  "home.w2d": r("يتغير شكله مع طول الاحتفاظ به، وأي نقل يعيد العدّاد.", "Its look changes the longer it is held; any transfer resets the clock.", "Его вид меняется, чем дольше его хранят; любая передача сбрасывает счётчик.", "Ne kadar uzun tutulursa görünümü değişir; her transfer sayacı sıfırlar.", "هرچه بیشتر نگه داشته شود ظاهرش تغییر می‌کند؛ هر انتقال شمارنده را از نو می‌کند."),
  "home.w3h": r("ندرة حقيقية", "Real rarity", "Настоящая редкость", "Gerçek nadirlik", "کمیابی واقعی"),
  "home.w3d": r("قواعد الندرة معلنة ومكتوبة في العقد. لا أحد يعرف ولا يغيّر شيئاً بعد النشر.", "Rarity rules are public and written in the contract. Nobody can change them after launch.", "Правила редкости открыты и записаны в контракте. Никто не может изменить их после запуска.", "Nadirlik kuralları herkese açıktır ve sözleşmeye yazılıdır. Yayından sonra kimse değiştiremez.", "قواعد کمیابی علنی و در قرارداد نوشته شده است. پس از انتشار هیچ‌کس نمی‌تواند آن را تغییر دهد."),
  "home.w4h": r("عدالة", "Fairness", "Честность", "Adalet", "انصاف"),
  "home.w4d": r("صناديق الغموض تُكشف بعشوائية لا يعرفها أحد مسبقاً، حتى نحن.", "Mystery boxes are revealed with randomness nobody knows in advance, not even us.", "Мистери-боксы раскрываются случайностью, которую никто не знает заранее — даже мы.", "Gizem kutuları, kimsenin önceden bilmediği bir rastgelelikle açılır; biz de dahil.", "جعبه‌های اسرار با تصادفی گشوده می‌شوند که هیچ‌کس از پیش نمی‌داند، حتی ما."),
  "home.mbtn": r("صندوق الغموض", "Mystery box", "Мистери-бокс", "Gizem kutusu", "جعبهٔ اسرار"),
  "home.abtn": r("المزادات الأسطورية", "Mythic auctions", "Мифические аукционы", "Efsanevi müzayedeler", "حراج‌های اسطوره‌ای"),

  "date.title": r("ابحث عن تاريخك", "Find your date", "Найдите свою дату", "Tarihini bul", "تاریخ خود را پیدا کنید"),
  "date.taken": r("مأخوذ", "Taken", "Занято", "Alınmış", "گرفته شده"),
  "date.owner": r("المالك", "Owner", "Владелец", "Sahibi", "مالک"),
  "date.view": r("اعرض الرمز وقصته", "View the token and its story", "Открыть токен и его историю", "Token'ı ve hikâyesini gör", "توکن و داستانش را ببینید"),
  "date.notSeason": r("هذا التاريخ ليس في الموسم المفتوح حالياً. سيُطرح في موسم لاحق.", "This date is not in the open season. It will come in a later season.", "Этой даты нет в текущем сезоне. Она появится позже.", "Bu tarih açık sezonda değil. Daha sonraki bir sezonda gelecek.", "این تاریخ در فصل باز نیست. در فصلی بعدی عرضه می‌شود."),
  "date.inBox": r("هذا التاريخ داخل صناديق الغموض. قد يكون من نصيبك.", "This date is inside the mystery boxes. It might be yours.", "Эта дата внутри мистери-боксов. Возможно, она достанется вам.", "Bu tarih gizem kutularının içinde. Sana çıkabilir.", "این تاریخ در جعبه‌های اسرار است. شاید نصیب شما شود."),
  "date.fees": r("+ رسوم الشبكة (ما لا يُستهلك يُرجَع إليك)", "+ network fees (whatever is unused is refunded)", "+ комиссия сети (неиспользованное возвращается)", "+ ağ ücreti (kullanılmayan kısım iade edilir)", "+ کارمزد شبکه (مقدار مصرف‌نشده بازگردانده می‌شود)"),
  "date.buy": r("اصنع أثري", "Make my mark", "Создать мой след", "İzimi bırak", "ردّ من را بساز"),
  "date.notStarted": r("البيع لم يبدأ بعد", "Sale has not started", "Продажа ещё не началась", "Satış henüz başlamadı", "فروش هنوز شروع نشده"),
  "date.mythic": r("تاريخ أسطوري: يُباع بالمزاد فقط.", "Mythic date: sold by auction only.", "Мифическая дата: продаётся только на аукционе.", "Efsanevi tarih: yalnızca müzayedeyle satılır.", "تاریخ اسطوره‌ای: فقط با حراج فروخته می‌شود."),
  "date.toAuctions": r("اذهب إلى المزادات", "Go to auctions", "Перейти к аукционам", "Müzayedelere git", "رفتن به حراج‌ها"),
  "date.sent": r("تم إرسال الطلب. إن كان التاريخ متاحاً سيصلك الرمز خلال لحظات.", "Request sent. If the date is still free, your token arrives in moments.", "Запрос отправлен. Если дата свободна, токен придёт через несколько секунд.", "İstek gönderildi. Tarih hâlâ boşsa token birkaç saniye içinde gelir.", "درخواست ارسال شد. اگر تاریخ آزاد باشد، توکن تا لحظاتی دیگر می‌رسد."),
  "date.cant": r("لا تجد تاريخك؟ ربما لم يُفتح موسمه بعد. جرّب", "Can't find your date? Its season may not be open yet. Try the", "Не нашли дату? Возможно, её сезон ещё не открыт. Попробуйте", "Tarihini bulamadın mı? Sezonu henüz açılmamış olabilir. Şunu dene:", "تاریخ خود را پیدا نکردید؟ شاید فصلش هنوز باز نشده. این را امتحان کنید:"),

  "gift.toggle": r("اهدِ هذا التاريخ لشخص آخر", "Gift this date to someone", "Подарить эту дату другому человеку", "Bu tarihi birine hediye et", "این تاریخ را به کسی هدیه دهید"),
  "gift.ph": r("عنوان محفظة المستلم (UQ… أو EQ…)", "Recipient wallet address (UQ… or EQ…)", "Адрес кошелька получателя (UQ… или EQ…)", "Alıcının cüzdan adresi (UQ… veya EQ…)", "نشانی کیف پول گیرنده (UQ… یا EQ…)"),
  "gift.buy": r("اشترِ وأهدِ", "Buy and gift", "Купить и подарить", "Satın al ve hediye et", "بخرید و هدیه دهید"),
  "gift.bad": r("العنوان غير صحيح", "Invalid address", "Неверный адрес", "Geçersiz adres", "نشانی نامعتبر"),
  "tok.notMinted": r("هذا الرمز لم يُصكّ بعد.", "This token has not been minted yet.", "Этот токен ещё не выпущен.", "Bu token henüz basılmadı.", "این توکن هنوز ضرب نشده است."),
  "tok.share": r("شارك", "Share", "Поделиться", "Paylaş", "اشتراک‌گذاری"),
  "tok.shareText": r("أثري: {d}", "My Athar: {d}", "Мой Athar: {d}", "Athar'ım: {d}", "اثر من: {d}"),
  "tok.yours": r("هذا رمزك", "Your token", "Ваш токен", "Senin token'ın", "توکن شماست"),
  "tok.owner": r("المالك الحالي", "Current owner", "Текущий владелец", "Mevcut sahip", "مالک فعلی"),
  "tok.hands": r("عدد الأيادي", "Hands it passed through", "Сколько рук прошёл", "Geçtiği el sayısı", "تعداد دست‌ها"),
  "tok.season": r("الموسم", "Season", "Сезон", "Sezon", "فصل"),
  "tok.paid": r("سعر الصك الأول", "First mint price", "Цена первого выпуска", "İlk basım fiyatı", "قیمت ضرب اول"),
  "tok.minted": r("صُكّ في", "Minted on", "Выпущен", "Basım tarihi", "تاریخ ضرب"),
  "tok.since": r("منذ آخر نقل", "Since last transfer", "С последней передачи", "Son transferden beri", "از آخرین انتقال"),
  "tok.days": r("{n} يوماً", "{n} days", "{n} дн.", "{n} gün", "{n} روز"),
  "tok.memory": r("ذاكرة الرمز", "The token's memory", "Память токена", "Token'ın hafızası", "حافظهٔ توکن"),
  "tok.noEngr": r("لا نقوش بعد. أول من يكتب يترك أثره الأول.", "No engravings yet. The first to write leaves the first mark.", "Гравировок пока нет. Первый, кто напишет, оставит первый след.", "Henüz kazıma yok. İlk yazan ilk izi bırakır.", "هنوز حکاکی‌ای نیست. اولین نویسنده اولین ردّ را می‌گذارد."),
  "tok.engrPh": r("اكتب سطراً (حتى 32 بايتاً)", "Write a line (up to 32 bytes)", "Напишите строку (до 32 байт)", "Bir satır yaz (en fazla 32 bayt)", "یک سطر بنویسید (تا ۳۲ بایت)"),
  "tok.engrBtn": r("انقش (0.1 TON)", "Engrave (0.1 TON)", "Выгравировать (0.1 TON)", "Kazı (0.1 TON)", "حک کنید (۰٫۱ TON)"),
  "tok.engrHelp": r("الحد 32 بايتاً: نحو 16 حرفاً عربياً أو 32 حرفاً لاتينياً. النقش يبقى للأبد ويقرؤه كل من يملك الرمز بعدك.", "Limit 32 bytes: about 16 Arabic letters or 32 Latin letters. The engraving stays forever and every later owner can read it.", "Лимит 32 байта: около 16 арабских или 32 латинских букв. Гравировка остаётся навсегда, её прочтёт каждый следующий владелец.", "Sınır 32 bayt: yaklaşık 16 Arapça veya 32 Latin harf. Kazıma sonsuza dek kalır, sonraki her sahip okuyabilir.", "حداکثر ۳۲ بایت: حدود ۱۶ حرف عربی یا ۳۲ حرف لاتین. حکاکی برای همیشه می‌ماند و هر مالک بعدی آن را می‌خواند."),
  "tok.engrSent": r("تم إرسال النقش.", "Engraving sent.", "Гравировка отправлена.", "Kazıma gönderildi.", "حکاکی ارسال شد."),

  "mine.title": r("رموزي", "My tokens", "Мои токены", "Token'larım", "توکن‌های من"),
  "mine.connect": r("اربط محفظتك من الزر في الأعلى لتظهر رموزك.", "Connect your wallet with the button above to see your tokens.", "Подключите кошелёк кнопкой выше, чтобы увидеть свои токены.", "Token'larını görmek için yukarıdaki düğmeyle cüzdanını bağla.", "برای دیدن توکن‌هایتان، کیف پول را با دکمهٔ بالا وصل کنید."),
  "mine.none": r("لا تملك رموزاً بعد.", "You don't own any tokens yet.", "У вас пока нет токенов.", "Henüz token'ın yok.", "هنوز توکنی ندارید."),

  "mys.title": r("صندوق الغموض", "Mystery box", "Мистери-бокс", "Gizem kutusu", "جعبهٔ اسرار"),
  "mys.sub": r("تدفع الآن ويُكشف تاريخك لاحقاً في لحظة معلنة. قد يكون عادياً أو نادراً أو أسطورياً.", "You pay now and your date is revealed later, at an announced moment. It may be common, rare or mythic.", "Вы платите сейчас, а дата раскрывается позже, в объявленный момент. Она может оказаться обычной, редкой или мифической.", "Şimdi ödersin, tarihin daha sonra duyurulan bir anda açılır. Sıradan, nadir ya da efsanevi olabilir.", "اکنون می‌پردازید و تاریخ شما بعدتر، در لحظه‌ای اعلام‌شده آشکار می‌شود. ممکن است معمولی، کمیاب یا اسطوره‌ای باشد."),
  "mys.pnote": r("السعر يرتفع مع كل تذكرة ويهبط عندما يهدأ الطلب", "The price rises with every ticket and falls when demand cools", "Цена растёт с каждым билетом и падает, когда спрос стихает", "Fiyat her biletle yükselir, talep azalınca düşer", "قیمت با هر بلیت بالا می‌رود و وقتی تقاضا کم شود پایین می‌آید"),
  "mys.buy": r("اشترِ تذكرة", "Buy a ticket", "Купить билет", "Bilet al", "خرید بلیت"),
  "mys.revealed": r("تم الكشف", "Revealed", "Раскрыто", "Açıldı", "گشوده شد"),
  "mys.na": r("غير متاح الآن", "Not available now", "Сейчас недоступно", "Şu an uygun değil", "اکنون در دسترس نیست"),
  "mys.tickets": r("{a} من {b} تذكرة", "{a} of {b} tickets", "{a} из {b} билетов", "{b} biletten {a}", "{a} از {b} بلیت"),
  "mys.revealIn": r("الكشف بعد:", "Reveal in:", "Раскрытие через:", "Açılışa kalan:", "گشایش تا:"),
  "mys.odds": r("الاحتمالات (علنية)", "Odds (public)", "Шансы (открытые)", "Olasılıklar (açık)", "احتمالات (علنی)"),
  "mys.note1": r("قائمة التواريخ المخصصة للصناديق منشورة.", "The list of dates held for the boxes is published.", "Список дат для боксов опубликован.", "Kutular için ayrılan tarih listesi yayımlandı.", "فهرست تاریخ‌های اختصاص‌یافته به جعبه‌ها منتشر شده است."),
  "mys.noteLink": r("اطّلع عليها", "See it", "Посмотреть", "Gör", "ببینید"),
  "mys.note2": r("عند الكشف تُخلط بعشوائية لا يعرفها أحد مسبقاً، بما في ذلك نحن. وإن تأخرنا في الكشف، يستطيع أي شخص إجراءه بعد 3 أيام.", "At the reveal they are shuffled with randomness nobody knows in advance, including us. If we are late, anyone can trigger the reveal after 3 days.", "При раскрытии даты перемешиваются случайностью, неизвестной заранее никому, включая нас. Если мы опоздаем, любой сможет запустить раскрытие через 3 дня.", "Açılışta tarihler, kimsenin önceden bilmediği bir rastgelelikle karıştırılır; biz de dahil. Geç kalırsak 3 gün sonra herkes açılışı başlatabilir.", "هنگام گشایش، تاریخ‌ها با تصادفی درهم می‌شوند که هیچ‌کس از پیش نمی‌داند، از جمله ما. اگر دیر کنیم، پس از ۳ روز هر کسی می‌تواند گشایش را آغاز کند."),
  "mys.disc": r("ملاحظة: تذكرة الغموض ليست ضماناً لقيمة معينة. اشترِ فقط ما أنت مستعد لخسارة قيمته.", "Note: a mystery ticket does not guarantee any value. Only spend what you can afford to lose.", "Примечание: мистери-билет не гарантирует никакой стоимости. Тратьте только то, что готовы потерять.", "Not: gizem bileti belirli bir değer garanti etmez. Yalnızca kaybetmeyi göze alabileceğin kadarını harca.", "توجه: بلیت اسرار ارزش مشخصی را تضمین نمی‌کند. فقط به اندازه‌ای هزینه کنید که تحمل از دست دادنش را دارید."),
  "mys.mine": r("تذاكري", "My tickets", "Мои билеты", "Biletlerim", "بلیت‌های من"),
  "mys.connect": r("اربط محفظتك لعرض تذاكرك.", "Connect your wallet to see your tickets.", "Подключите кошелёк, чтобы увидеть билеты.", "Biletlerini görmek için cüzdanını bağla.", "برای دیدن بلیت‌ها کیف پول را وصل کنید."),
  "mys.noTickets": r("لا تذاكر بعد.", "No tickets yet.", "Билетов пока нет.", "Henüz bilet yok.", "هنوز بلیتی نیست."),
  "mys.ticket": r("تذكرة #{n}", "Ticket #{n}", "Билет №{n}", "Bilet #{n}", "بلیت #{n}"),
  "mys.sealed": r("مختومة", "Sealed", "Запечатан", "Mühürlü", "مهر و موم"),
  "mys.claim": r("استلم {d}", "Claim {d}", "Забрать {d}", "{d} al", "دریافت {d}"),
  "mys.sentT": r("تم إرسال طلب التذكرة.", "Ticket request sent.", "Запрос на билет отправлен.", "Bilet isteği gönderildi.", "درخواست بلیت ارسال شد."),
  "mys.sentC": r("تم إرسال طلب الاستلام.", "Claim request sent.", "Запрос на получение отправлен.", "Alma isteği gönderildi.", "درخواست دریافت ارسال شد."),

  "auc.title": r("المزادات الأسطورية", "Mythic auctions", "Мифические аукционы", "Efsanevi müzayedeler", "حراج‌های اسطوره‌ای"),
  "auc.intro": r("التواريخ الأسطورية (المتناظرة، والتواريخ التاريخية الكبرى) تُباع بالمزاد: السعر يحدده من يرغب فيها أكثر.", "Mythic dates (mirrored dates and the great historic ones) are sold by auction: the price is set by whoever wants them most.", "Мифические даты (зеркальные и великие исторические) продаются на аукционе: цену определяет тот, кто хочет их сильнее всех.", "Efsanevi tarihler (simetrik ve büyük tarihî günler) müzayedeyle satılır: fiyatı en çok isteyen belirler.", "تاریخ‌های اسطوره‌ای (متقارن و رویدادهای بزرگ تاریخی) با حراج فروخته می‌شوند: قیمت را کسی تعیین می‌کند که بیشتر می‌خواهدشان."),
  "auc.none": r("لا مزادات جارية الآن ({n} تاريخاً أسطورياً في الموسم). ستُعلن المزادات تباعاً.", "No live auctions right now ({n} mythic dates in the season). Auctions will be announced one by one.", "Сейчас нет активных аукционов ({n} мифических дат в сезоне). Аукционы будут объявляться по очереди.", "Şu an canlı müzayede yok (sezonda {n} efsanevi tarih). Müzayedeler sırayla duyurulacak.", "اکنون حراج فعالی نیست ({n} تاریخ اسطوره‌ای در این فصل). حراج‌ها یکی‌یکی اعلام می‌شوند."),
  "auc.high": r("أعلى عرض", "Highest bid", "Лучшая ставка", "En yüksek teklif", "بالاترین پیشنهاد"),
  "auc.reserve": r("السعر الابتدائي", "Starting price", "Начальная цена", "Başlangıç fiyatı", "قیمت پایه"),
  "auc.bidder": r("صاحب العرض", "Bidder", "Участник", "Teklif sahibi", "پیشنهاددهنده"),
  "auc.endsIn": r("ينتهي بعد", "Ends in", "Заканчивается через", "Bitişine", "پایان تا"),
  "auc.ended": r("انتهى", "Ended", "Завершён", "Bitti", "پایان یافت"),
  "auc.bid": r("قدّم عرضاً", "Place a bid", "Сделать ставку", "Teklif ver", "پیشنهاد دهید"),
  "auc.bidNote": r("إن تجاوزك أحد يُعاد مبلغك تلقائياً. وأي عرض في آخر 5 دقائق يمدّد المزاد 5 دقائق.", "If someone outbids you, your money is returned automatically. A bid in the last 5 minutes extends the auction by 5 minutes.", "Если вас перебьют, деньги вернутся автоматически. Ставка в последние 5 минут продлевает аукцион на 5 минут.", "Biri seni geçerse paran otomatik iade edilir. Son 5 dakikadaki teklif müzayedeyi 5 dakika uzatır.", "اگر کسی پیشنهاد بالاتری بدهد، پولتان خودکار بازمی‌گردد. پیشنهاد در ۵ دقیقهٔ آخر حراج را ۵ دقیقه تمدید می‌کند."),
  "auc.settle": r("إنهاء المزاد (يتسلم الفائز رمزه)", "Finish the auction (the winner receives the token)", "Завершить аукцион (победитель получает токен)", "Müzayedeyi bitir (kazanan token'ı alır)", "پایان حراج (برنده توکن را دریافت می‌کند)"),
  "auc.sentB": r("تم إرسال عرضك.", "Your bid was sent.", "Ваша ставка отправлена.", "Teklifin gönderildi.", "پیشنهاد شما ارسال شد."),
  "auc.sentS": r("تم إرسال طلب إنهاء المزاد.", "Auction finish request sent.", "Запрос на завершение аукциона отправлен.", "Müzayedeyi bitirme isteği gönderildi.", "درخواست پایان حراج ارسال شد."),
} satisfies Record<string, Row>;
export type Key = keyof typeof DICT;

export function detectLang(): Lang {
  try { const saved = localStorage.getItem("athar_lang"); if (saved && LANGS.some((l) => l.code === saved)) return saved as Lang; } catch { /* private mode */ }
  const tg = (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.language_code as string | undefined;
  const raw = (tg || navigator.language || "en").toLowerCase().split("-")[0];
  return (LANGS.find((l) => l.code === raw)?.code ?? "en") as Lang;
}

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (k: Key, vars?: Record<string, string | number>) => string; dateLabel: (y: number, m: number, d: number) => string; monthNames: string[]; rtl: boolean };
const LangCtx = createContext<Ctx>(null as unknown as Ctx);

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("ar");
  useEffect(() => { setLangState(detectLang()); }, []);
  const meta = LANGS.find((l) => l.code === lang)!;
  useEffect(() => { document.documentElement.lang = lang; document.documentElement.dir = meta.rtl ? "rtl" : "ltr"; }, [lang, meta.rtl]);
  const setLang = useCallback((l: Lang) => { setLangState(l); try { localStorage.setItem("athar_lang", l); } catch { /* ignore */ } }, []);
  const value = useMemo<Ctx>(() => {
    const tag = `${meta.locale}-u-ca-gregory-nu-latn`;
    const t: Ctx["t"] = (k, vars) => { let s = DICT[k][lang]; if (vars) for (const [a, b] of Object.entries(vars)) s = s.replace(`{${a}}`, String(b)); return s; };
    const fmt = new Intl.DateTimeFormat(tag, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
    const mf = new Intl.DateTimeFormat(tag, { month: "long", timeZone: "UTC" });
    return { lang, setLang, t, rtl: meta.rtl,
      dateLabel: (y, m, d) => fmt.format(new Date(Date.UTC(y, m - 1, d))),
      monthNames: Array.from({ length: 12 }, (_, i) => mf.format(new Date(Date.UTC(2001, i, 15)))) };
  }, [lang, meta, setLang]);
  return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>;
}
export const useI18n = () => useContext(LangCtx);
