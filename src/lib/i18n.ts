// Minimal AR/EN dictionary for the AD_BOT's end-user-facing screens (owner
// request 2026-08-31: "at least ar/en"). The Super Admin panel stays
// Arabic-only — it's a single-operator surface (the platform owner), not
// a multi-audience one, so translating it doubles the work for zero real
// benefit; everything an ordinary member or bot creator sees is covered.

export type Lang = "ar" | "en";
export const DEFAULT_LANG: Lang = "ar";

type Dict = Record<string, { ar: string; en: string }>;

export const STR: Dict = {
  btnCreateAd: { ar: "➕ ضع إعلانك", en: "➕ Create Ad" },
  btnMyAds: { ar: "📢 إعلاناتي", en: "📢 My Ads" },
  btnOwnerPanel: { ar: "🛠 لوحة المشرف", en: "🛠 Admin Panel" },
  ownerPanelTitle: { ar: "🛠 لوحة المشرف — إدارة بوتك:", en: "🛠 Admin Panel — manage your bot:" },
  btnWatchEarn: { ar: "👀 شاهد واربح", en: "👀 Watch & Earn" },
  btnWallet: { ar: "💰 المحفظة", en: "💰 Wallet" },
  btnReferrals: { ar: "🙌 الإحالات", en: "🙌 Referrals" },
  btnStats: { ar: "📊 إحصائيات", en: "📊 Stats" },
  btnLanguage: { ar: "🌐 اللغة", en: "🌐 Language" },
  btnFaq: { ar: "❓ الأسئلة الشائعة", en: "❓ FAQ" },
  btnAskNova: { ar: "✨ اسأل نوفا (ذكاء اصطناعي)", en: "✨ Ask Nova (AI)" },
  askNovaPrompt: {
    ar: "✨ اكتب سؤالك وسيجيبك نوفا (نفس مساعد الذكاء الاصطناعي في بوت Nova AI) — يشاركك نفس رصيدك المجاني اليومي هناك.",
    en: "✨ Type your question and Nova (the same AI assistant behind the Nova AI bot) will answer — it shares your same free daily quota there.",
  },
  btnDeposit: { ar: "📥 إيداع", en: "📥 Deposit" },
  btnWithdraw: { ar: "📤 سحب", en: "📤 Withdraw" },
  btnBack: { ar: "🔙 القائمة الرئيسية", en: "🔙 Main Menu" },
  btnRetweet: { ar: "🔁 إعادة تغريد", en: "🔁 Retweet" },
  btnFollow: { ar: "➕ متابعة", en: "➕ Follow" },
  btnConfirmSend: { ar: "✅ تأكيد الإرسال", en: "✅ Confirm" },
  btnCancel: { ar: "❌ إلغاء", en: "❌ Cancel" },
  btnDepositNow: { ar: "💳 إيداع الآن", en: "💳 Deposit Now" },
  btnLangAr: { ar: "🇸🇦 العربية", en: "🇸🇦 Arabic" },
  btnLangEn: { ar: "🇬🇧 English", en: "🇬🇧 English" },
  btnSharePhone: { ar: "📱 مشاركة رقم الهاتف", en: "📱 Share phone number" },
  btnWantOwnBot: { ar: "ℹ️ أريد بوتاً مماثلاً", en: "ℹ️ I want a bot like this" },
  btnProceedPurchase: { ar: "💳 متابعة للشراء", en: "💳 Proceed to purchase" },

  welcome: { ar: "🚀 مرحباً بك في منصة الإعلانات! اختر من القائمة أدناه:", en: "🚀 Welcome to the ads platform! Choose from the menu below:" },
  adminNote: { ar: "\n\n🛠 أنت مالك المنصة — أرسل /admin لفتح لوحة التحكم.", en: "\n\n🛠 You're the platform owner — send /admin to open the control panel." },
  mainMenuTitle: { ar: "🏠 القائمة الرئيسية:", en: "🏠 Main menu:" },
  chooseUnknown: { ar: "يرجى الاختيار من القائمة السفلية فقط.", en: "Please choose from the menu below only." },

  createAdTitle: { ar: "📢 إضافة إعلان جديد\nاختر المنصة:", en: "📢 New ad\nChoose a platform:" },
  choosePlatform: { ar: "اختر المنصة:", en: "Choose a platform:" },
  walletTitle: { ar: "💳 قسم المحفظة", en: "💳 Wallet" },
  walletBalance: { ar: "رصيدك الحالي: {balance}\nاختر العملية المطلوبة:", en: "Your balance: {balance}\nChoose an action:" },
  referralLink: { ar: "🔗 رابط الإحالة الخاص بك:\n{link}", en: "🔗 Your referral link:\n{link}" },
  langCurrent: { ar: "اختر لغتك المفضّلة:", en: "Choose your preferred language:" },
  langSet: { ar: "✅ تم تعيين اللغة إلى العربية.", en: "✅ Language set to English." },
  faqBody: {
    ar: "❓ الأسئلة الشائعة:\n\n• كيف أربح؟ اضغط «شاهد واربح»، اختر منصة، وأتمّ المهام المتاحة.\n• كيف أعلن؟ اضغط «ضع إعلانك»، حدد ميزانيتك وسعر النقرة.\n• كيف أودع/أسحب؟ من «المحفظة».\n• هل التحقق حقيقي؟ نعم — لكل المنصات. قنوات تلجرام تُتحقق فوراً ومباشرة، وبقية المنصات (رابط، يوتيوب، تويتر، تيك توك، فيسبوك، انستغرام) تمر بنظام مراقبة إلزامي في الخلفية (عدّاد زمني لا يمكن تجاوزه) قبل تفعيل زر التأكيد، إلى جانب أنظمة حماية إضافية لرصد الحسابات المكررة ومراجعة دورية لمن يغادر القنوات بعد وقت قصير.\n\nهل تريد بوتاً كهذا لنفسك؟ اضغط الزر أدناه.",
    en: "❓ FAQ:\n\n• How do I earn? Tap \"Watch & Earn\", pick a platform, complete available tasks.\n• How do I advertise? Tap \"Create Ad\", set your budget and cost-per-click.\n• How do I deposit/withdraw? From \"Wallet\".\n• Is verification real? Yes — for every platform. Telegram channels are checked instantly and directly; every other platform (link, YouTube, Twitter, TikTok, Facebook, Instagram) goes through a mandatory background monitoring gate (a timer that can't be skipped) before the confirm button unlocks, plus additional protection against duplicate accounts and periodic review of anyone who leaves a channel shortly after joining.\n\nWant a bot like this for yourself? Tap the button below.",
  },

  withdrawAmountPrompt: { ar: "أرسل المبلغ المراد سحبه بالدولار (الحد الأدنى ${min}):", en: "Send the amount to withdraw in USD (minimum ${min}):" },
  withdrawMinError: { ar: "الحد الأدنى للسحب ${min}. أرسل رقماً صحيحاً.", en: "Minimum withdrawal is ${min}. Send a valid number." },
  withdrawInsufficient: { ar: "رصيدك {balance} فقط.", en: "Your balance is only {balance}." },
  withdrawSent: { ar: "تم إرسال طلب سحب {amount}. سيُراجَع من مالك المنصة.", en: "Withdrawal request for {amount} sent. It will be reviewed by the platform owner." },
  withdrawAddressPrompt: { ar: "أرسل عنوان محفظتك (USDT-TRC20 أو TON) لاستلام السحب:", en: "Send your wallet address (USDT-TRC20 or TON) to receive the withdrawal:" },
  withdrawAddressError: { ar: "أرسل عنوان محفظة صالح.", en: "Send a valid wallet address." },

  phoneVerifyPrompt: {
    ar: "🔒 لحماية المنصة من الحسابات الوهمية، يرجى تأكيد رقم هاتفك أولاً بالضغط على الزر أدناه:",
    en: "🔒 To protect the platform from fake accounts, please verify your phone number first by tapping the button below:",
  },
  phoneVerified: { ar: "✅ تم تأكيد رقم هاتفك بنجاح. يمكنك الآن إتمام المهام.", en: "✅ Your phone number is verified. You can now complete tasks." },
  phoneMismatch: { ar: "⚠️ يجب مشاركة رقم هاتفك الخاص فقط.", en: "⚠️ You must share your own phone number." },
  phoneRequiredAlert: { ar: "🔒 يجب تأكيد رقم هاتفك أولاً — انظر الرسالة الجديدة.", en: "🔒 You must verify your phone number first — see the new message." },
  accountFlaggedAlert: { ar: "🚫 تم إيقاف حسابك مؤقتاً لأسباب أمنية. تواصل مع الدعم.", en: "🚫 Your account is temporarily on hold for security reasons. Contact support." },

  carouselReport: { ar: "🚩 إبلاغ", en: "🚩 Report" },
  reportAlready: { ar: "لقد أبلغت عن هذا الإعلان مسبقاً.", en: "You've already reported this ad." },
  reportReceived: { ar: "✅ تم استلام بلاغك، شكراً لك.", en: "✅ Report received, thank you." },

  adAutoRejected: {
    ar: "⚠️ تم رفض إعلانك تلقائياً لمخالفته شروط المحتوى (كلمات محظورة أو رابط غير آمن). لم يُخصم أي مبلغ من رصيدك.",
    en: "⚠️ Your ad was automatically rejected for violating content rules (banned words or an unsafe link). No amount was charged.",
  },

  btnScopeTargeted: { ar: "🎯 حملة خاصة بهذا البوت", en: "🎯 This bot only" },
  btnScopeGlobal: { ar: "🌐 حملة عامة في كافة البوتات", en: "🌐 Global — all bots" },
  adScopePrompt: {
    ar: "أين تريد عرض حملتك؟\n🎯 خاصة: تظهر فقط لمستخدمي هذا البوت.\n🌐 عامة: تظهر في كل البوتات على المنصة (أولوية لهذا البوت أولاً).",
    en: "Where should your campaign appear?\n🎯 This bot only: shown just to this bot's users.\n🌐 Global: shown across every bot on the platform (this bot gets priority).",
  },
  adReviewScope: { ar: "النطاق: {scope}", en: "Scope: {scope}" },
  adSubtypePrompt: { ar: "اختر نوع مهمة تويتر:", en: "Choose the Twitter task type:" },
  adDescriptionPrompt: { ar: "أرسل وصف حملتك (نص قصير يظهر للمستخدمين):", en: "Send your campaign description (short text shown to users):" },
  adTargetPrompt: { ar: "أرسل الرابط/الحساب/القناة الذي تريد الترويج له:", en: "Send the link/account/channel you want to promote:" },
  adBudgetPrompt: { ar: "حدد ميزانية حملتك بالدولار (مثال: 100):", en: "Set your campaign budget in USD (example: 100):" },
  adCpcPrompt: { ar: "حدد السعر لكل نقرة/مهمة بالدولار (الحد الأدنى ${min}):", en: "Set the cost per click/task in USD (minimum ${min}):" },
  adDescriptionEmptyError: { ar: "أرسل وصفاً غير فارغ.", en: "Send a non-empty description." },
  adTargetEmptyError: { ar: "أرسل رابطاً أو حساباً أو قناة فعلياً — لا يمكن ترك هذا الحقل فارغاً.", en: "Send an actual link, account, or channel — this field can't be empty." },
  adTelegramChannelNotFound: {
    ar: "⚠️ تعذّر العثور على {handle} على تيليجرام. تأكد من صحة معرّف القناة/المجموعة (يجب أن تكون عامة) وأرسله مجدداً.",
    en: "⚠️ Couldn't find {handle} on Telegram. Make sure the channel/group username is correct (it must be public) and send it again.",
  },
  adTelegramBotNotAdminWarning: {
    ar: "✅ تم العثور على {handle}، لكن يجب إضافة هذا البوت كـ«مشرف (Admin)» فيها ليتمكن من التحقق من انضمام المشاهدين — وإلا فلن يحصل أي مشاهد على المكافأة لاحقاً. أضف البوت كمشرف ثم تابع.",
    en: "✅ Found {handle}, but this bot must be added as an ADMIN there to verify viewers actually joined — otherwise no viewer will ever be able to claim the reward. Add the bot as admin, then continue.",
  },
  adTelegramBotTargetOwnPlatform: {
    ar: "✅ تم العثور على {handle} — وهو أحد بوتات منصتنا، لذا سيتم تأكيد مشاهدة كل مستخدم تلقائياً وفورياً بمجرد ضغطه «ابدأ» فيه، دون أي إعداد إضافي منك.",
    en: "✅ Found {handle} — it's one of our own platform's bots, so every viewer's visit is confirmed automatically the instant they tap Start there, no extra setup needed.",
  },
  adTelegramBotTargetExternal: {
    ar: "✅ تم العثور على {handle}. تنبيه: بما أنه بوت خارجي لا تديره منصتنا، لا يمكننا تأكيد ما يفعله المستخدم بداخله فعلياً — سيُعتمد بدلاً من ذلك على مرور الوقت المطلوب بعد فتحه، كما في إعلانات الروابط الخارجية.",
    en: "✅ Found {handle}. Note: since it's an external bot not run by our platform, we can't confirm what the user actually does inside it — verification will instead rely on the required time elapsing after they open it, same as external link ads.",
  },
  adBudgetError: { ar: "أرسل رقماً صحيحاً أكبر من صفر بالدولار.", en: "Send a valid number greater than zero, in USD." },
  adCpcMinError: { ar: "السعر لكل نقرة على {platform} لا يقل عن ${min}.", en: "Cost per click on {platform} must be at least ${min}." },
  adCpcOverBudgetError: { ar: "السعر لكل نقرة أكبر من الميزانية الكلية.", en: "Cost per click is greater than the total budget." },
  adReviewTitle: { ar: "مراجعة حملتك — {platform}", en: "Review your campaign — {platform}" },
  adReviewType: { ar: "النوع: {type}", en: "Type: {type}" },
  adReviewDesc: { ar: "الوصف: {desc}", en: "Description: {desc}" },
  adReviewTarget: { ar: "الهدف: {target}", en: "Target: {target}" },
  adReviewBudget: { ar: "الميزانية: {budget}", en: "Budget: {budget}" },
  adReviewCpc: { ar: "سعر النقرة: {cpc}", en: "Cost per click: {cpc}" },
  adReviewClicks: { ar: "عدد النقرات المتوقع: ~{clicks}", en: "Expected clicks: ~{clicks}" },
  adCancelled: { ar: "أُلغيت الحملة.", en: "Campaign cancelled." },
  adInsufficientBalance: {
    ar: "الميزانية {budget} أكبر من رصيدك ({balance}).\nأودع رصيداً ثم اضغط «✅ تأكيد الإرسال» مجدداً:\n{link}",
    en: "Budget {budget} is greater than your balance ({balance}).\nDeposit funds then tap \"✅ Confirm\" again:\n{link}",
  },
  adDepositThenConfirm: { ar: "بعد الإيداع اضغط «✅ تأكيد الإرسال» مجدداً لإطلاق حملتك.", en: "After depositing, tap \"✅ Confirm\" again to launch your campaign." },
  adLaunched: { ar: "تم إطلاق حملتك (خُصم {budget}). ستظهر الآن في «شاهد واربح» لكل المستخدمين.", en: "Your campaign is live (charged {budget}). It now appears in \"Watch & Earn\" for every user." },

  // "📢 إعلاناتي" — post-launch ad management (owner spec, 2026-08-31):
  // track clicks/remaining budget, pause/resume, cancel with refund, top up.
  myAdsEmpty: { ar: "لا توجد لديك إعلانات بعد. اضغط «➕ ضع إعلانك» لإنشاء أول حملة.", en: "You don't have any ads yet. Tap \"➕ Create Ad\" to launch your first campaign." },
  myAdsListTitle: { ar: "📢 إعلاناتك — اضغط على إعلان لإدارته:", en: "📢 Your ads — tap one to manage it:" },
  myAdNotFound: { ar: "لم يُعثر على هذا الإعلان أو أنه لا يخصك.", en: "That ad wasn't found, or it isn't yours." },
  myAdDetail: {
    ar: "📢 تفاصيل الإعلان #{id}\n\n🎯 المنصة: {platform}\n📌 الحالة: {status}\n💵 سعر النقرة: {cpc}\n💰 الميزانية الكلية: {total}\n💳 المتبقي: {remaining}\n📉 المُنفق حتى الآن: {spent}\n👆 عدد الإنجازات: {clicks}",
    en: "📢 Ad #{id} details\n\n🎯 Platform: {platform}\n📌 Status: {status}\n💵 Cost per click: {cpc}\n💰 Total budget: {total}\n💳 Remaining: {remaining}\n📉 Spent so far: {spent}\n👆 Completions: {clicks}",
  },
  myAdBtnPause: { ar: "⏸️ إيقاف مؤقت", en: "⏸️ Pause" },
  myAdBtnResume: { ar: "▶️ استئناف", en: "▶️ Resume" },
  myAdBtnCancel: { ar: "❌ إلغاء الإعلان", en: "❌ Cancel ad" },
  myAdBtnTopup: { ar: "💰 إضافة رصيد", en: "💰 Top up" },
  myAdBtnBackToList: { ar: "🔙 كل إعلاناتي", en: "🔙 All my ads" },
  myAdPaused: { ar: "⏸️ تم إيقاف الإعلان مؤقتاً. لن يظهر ضمن «شاهد واربح» حتى تستأنفه.", en: "⏸️ The ad is now paused. It won't appear in \"Watch & Earn\" until you resume it." },
  myAdResumed: { ar: "▶️ تم استئناف الإعلان، وأصبح ظاهراً في «شاهد واربح» مجدداً.", en: "▶️ The ad is active again and visible in \"Watch & Earn\"." },
  myAdCancelConfirm: {
    ar: "⚠️ سيتم إلغاء هذا الإعلان نهائياً واسترداد المتبقي منه ({amount}) إلى محفظتك. هل أنت متأكد؟",
    en: "⚠️ This will permanently cancel the ad and refund its remaining balance ({amount}) to your wallet. Are you sure?",
  },
  myAdCancelledOk: { ar: "❌ أُلغي الإعلان، وأُضيف {amount} إلى رصيد محفظتك.", en: "❌ The ad was cancelled and {amount} was added back to your wallet balance." },
  campaignEndedReport: {
    ar: "🏁 انتهت حملتك #{id} ({platform}) — استُهلكت الميزانية بالكامل.\n\n💰 إجمالي الإنفاق: {total}\n👆 عدد الإنجازات: {clicks}\n\nيمكنك تجديدها بشحن رصيد إضافي من «إعلاناتي».",
    en: "🏁 Your campaign #{id} ({platform}) has ended — its budget is fully spent.\n\n💰 Total spent: {total}\n👆 Completions: {clicks}\n\nYou can top it up again from \"My Ads\".",
  },
  myAdCancelAborted: { ar: "لم يتم الإلغاء.", en: "Cancellation aborted." },
  myAdBtnDelete: { ar: "🗑 حذف نهائياً", en: "🗑 Delete permanently" },
  myAdDeleteConfirm: {
    ar: "⚠️ سيُحذف هذا الإعلان نهائياً من قائمتك (هذه الحملة منتهية أصلاً ولا رصيد فيها لاسترداده). هل أنت متأكد؟",
    en: "⚠️ This will permanently delete this ad from your list (this campaign already ended, with nothing left to refund). Are you sure?",
  },
  myAdDeletedOk: { ar: "🗑 تم حذف الإعلان نهائياً.", en: "🗑 The ad was permanently deleted." },
  myAdTopupPrompt: { ar: "أرسل المبلغ الذي تريد إضافته لرصيد هذا الإعلان بالدولار:", en: "Send the amount in USD you want to add to this ad's budget:" },
  myAdTopupInvalid: { ar: "أرسل رقماً صحيحاً أكبر من صفر.", en: "Send a valid number greater than zero." },
  myAdTopupInsufficient: {
    ar: "المبلغ المطلوب {amount} أكبر من رصيد محفظتك ({balance}).\nأودع رصيداً أولاً:\n{link}",
    en: "The requested amount {amount} is greater than your wallet balance ({balance}).\nDeposit funds first:\n{link}",
  },
  myAdTopupDone: {
    ar: "✅ أُضيف {amount} لرصيد الإعلان. المتبقي الآن: {remaining}.",
    en: "✅ {amount} added to the ad's budget. Remaining balance is now: {remaining}.",
  },
  adStatusActive: { ar: "🟢 نشط", en: "🟢 Active" },
  adStatusPaused: { ar: "⏸️ متوقف مؤقتاً", en: "⏸️ Paused" },
  adStatusExpired: { ar: "🟡 نفذ الرصيد", en: "🟡 Out of budget" },
  adStatusCancelled: { ar: "⚪ ملغى", en: "⚪ Cancelled" },
  adStatusRejected: { ar: "🔴 مرفوض (مخالفة الشروط)", en: "🔴 Rejected (policy violation)" },
  adStatusFlagged: { ar: "🚩 موقوف (بلاغات مستخدمين)", en: "🚩 Flagged (user reports)" },

  watchNoAds: { ar: "لا حملات متاحة على هذه المنصة حالياً.", en: "No campaigns available on this platform right now." },
  watchForcedLabel: { ar: "🌟 عرض من المنصة", en: "🌟 Platform promotion" },

  // Single-ad InlineKeyboard carousel (owner instruction, 2026-08-31 — a
  // deliberate, explicit exception to the reply-keyboard-only rule for this
  // one screen only).
  carouselAdTitle: { ar: "🎯 {platform}", en: "🎯 {platform}" },
  carouselReward: { ar: "💰 المكافأة: {reward}", en: "💰 Reward: {reward}" },
  carouselTimerNotice: {
    ar: "⏱ بعد فتح الرابط ستظهر لك صفحة بها عدّاد {seconds} ثانية — انتظر حتى ينتهي، اضغط «متابعة» هناك، ثم عد واضغط «تحقق من الإنجاز» هنا. الضغط على «تحقق» قبل انتهاء العدّاد لن يُحتسب.",
    en: "⏱ After you open the link, a page with a {seconds}-second countdown will appear — wait for it to finish, tap \"Continue\" there, then come back and tap \"Verify completion\" here. Tapping Verify before the countdown ends won't count.",
  },
  carouselVerify: { ar: "✅ تحقق من الإنجاز", en: "✅ Verify completion" },
  carouselNext: { ar: "➡️ الإعلان التالي", en: "➡️ Next ad" },
  carouselExit: { ar: "❌ إلغاء/خروج", en: "❌ Cancel/Exit" },
  carouselNotDoneAlert: {
    ar: "⚠️ لم تكتمل مدة المراقبة بعد. إن كنت فتحت الرابط للتو، انتظر حتى ينتهي العدّاد في الصفحة ثم اضغط «متابعة» هناك، ثم أعد الضغط هنا.",
    en: "⚠️ The monitoring window hasn't finished yet. If you just opened the link, wait for the countdown on that page to finish and tap \"Continue\" there, then tap this button again.",
  },
  carouselSuccess: { ar: "🎉 تم إضافة {amount} لرصيدك بنجاح!\nرصيدك الآن: {balance}.", en: "🎉 {amount} added to your balance!\nYour balance is now: {balance}." },
  carouselCancelled: { ar: "تم إلغاء التصفح.", en: "Browsing cancelled." },
  carouselDone: { ar: "🎉 لا مزيد من الإعلانات المتاحة حالياً.", en: "🎉 No more ads available right now." },

  taskGone: { ar: "هذه المهمة لم تعد متاحة.", en: "This task is no longer available." },
  taskOwnCampaign: { ar: "لا يمكنك إتمام حملتك الخاصة.", en: "You can't complete your own campaign." },
  taskNotJoined: { ar: "لم يتم التحقق من انضمامك بعد إلى {channel}. انضم ثم أعد المحاولة.", en: "Couldn't verify you've joined {channel} yet. Join then try again." },
  taskVerifyFailed: { ar: "تعذّر التحقق من العضوية. تأكد أن رابط القناة صحيح وأن البوت مشرف فيها.", en: "Couldn't verify membership. Make sure the channel link is correct and the bot is an admin there." },
  taskAlreadyClaimed: { ar: "استفدت من هذه المهمة مسبقاً.", en: "You've already claimed this task." },
  taskRewarded: { ar: "أُضيف {amount}! رصيدك الآن: {balance}.", en: "{amount} added! Your balance is now: {balance}." },

  statsTitle: {
    ar: "📊 إحصائياتك:\nحملات أنشأتها: {ads}\nإجمالي الصرف: {spent}\nمهام أتممتها: {tasks}\nإجمالي أرباحك: {earned}",
    en: "📊 Your stats:\nCampaigns created: {ads}\nTotal spent: {spent}\nTasks completed: {tasks}\nTotal earned: {earned}",
  },

  depositChoose: { ar: "اختر مبلغ الإيداع وعملتك المفضّلة (USDT, TRX, TON, LTC, SOL...) في الصفحة:\n{link}", en: "Choose your deposit amount and preferred currency (USDT, TRX, TON, LTC, SOL...) on the page:\n{link}" },

  // Native TON deposit — a second, direct path alongside the NOWPayments
  // link above (owner spec, 2026-09-02), shown only when the platform's
  // shared hot wallet is configured.
  btnTonDeposit: { ar: "💎 إيداع TON / USDT مباشر", en: "💎 Direct TON / USDT Deposit" },
  tonDepositInfo: {
    ar: "💎 إيداع TON أو USDT مباشر (أسرع وأقل رسوماً من الدفع عبر NOWPayments)\n\n📮 العنوان: {address}\n🔖 رمز التعريف (Memo/Comment) الخاص بك: {memo}\n\n✅ يمكنك إرسال TON أو USDT (فقط على شبكة TON — لا ترسل USDT من شبكة أخرى مثل TRC20/ERC20 لهذا العنوان).\n⚠️ يجب إضافة رمز التعريف أعلاه بالضبط في خانة \"التعليق/Comment/Memo\" عند التحويل، وإلا لن يُحتسب إيداعك تلقائياً.\n\n⏳ يُضاف المبلغ لرصيدك تلقائياً خلال 24 ساعة من تأكيد المعاملة على الشبكة.",
    en: "💎 Direct TON or USDT deposit (faster and cheaper than paying via NOWPayments)\n\n📮 Address: {address}\n🔖 Your memo/comment code: {memo}\n\n✅ You can send either TON or USDT (TON network only — do not send USDT from another network like TRC20/ERC20 to this address).\n⚠️ You must add the code above exactly in the transfer's \"Comment/Memo\" field, or your deposit won't be credited automatically.\n\n⏳ The amount is added to your balance automatically within 24 hours of the transaction confirming on-chain.",
  },

  // "أريد بوتاً مماثلاً" — the paid bot-purchase flow (owner spec,
  // 2026-08-31). Deliberately says only what a buyer needs to decide: the
  // 50% user payout as a selling point, not the internal creator/platform
  // split or referral mechanics.
  wantOwnBotInfo: {
    ar: "ℹ️ إنشاء بوتك الخاص\n\nيمكنك امتلاك بوت إعلانات وربح خاص بك، يعمل بنفس نظام هذا البوت بالكامل:\n\n📌 كيف يعمل؟\n• مستخدمو بوتك يربحون 50% من قيمة كل مهمة يكملونها (مشاهدة إعلان، الانضمام لقناة، وغيرها).\n• يمكنهم أيضاً إنشاء إعلاناتهم الخاصة داخل بوتك.\n• أنت كمالك للبوت تحصل على عمولة من كل نشاط يحدث داخله، قابلة للسحب بانتظام.\n\n💰 السعر: 100$ لمرة واحدة فقط (بلا اشتراك متكرر) — تفعيل فوري بعد التحقق من التحويل.\n\nللمتابعة اضغط الزر أدناه:",
    en: "ℹ️ Create your own bot\n\nYou can own your own ads-and-earnings bot, running on the exact same system as this one:\n\n📌 How it works?\n• Your bot's users earn 50% of the value of every task they complete (watching an ad, joining a channel, etc.).\n• They can also create their own ad campaigns inside your bot.\n• As the bot owner, you earn a commission on every activity inside it, withdrawable regularly.\n\n💰 Price: a one-time $100 (no recurring subscription) — instant activation once your transfer is verified.\n\nTap below to continue:",
  },
  purchaseBankInfo: {
    ar: "💳 لإتمام الشراء ({amount}$)، حوّل المبلغ عبر إحدى الطرق التالية:\n\n🏦 تحويل بنكي:\nالمستفيد: {holder}\nرقم الحساب: {account}\n\n💵 أو USDT ({usdtNet}):\n{usdtAddr}\n\nبعد التحويل، أرسل هنا اسمك أو رقم/مرجع عملية التحويل للمراجعة:",
    en: "💳 To complete the purchase (${amount}), transfer via one of the following:\n\n🏦 Bank transfer:\nBeneficiary: {holder}\nAccount number: {account}\n\n💵 Or USDT ({usdtNet}):\n{usdtAddr}\n\nAfter transferring, send your name or the transfer reference here for review:",
  },
  purchaseRefEmptyError: { ar: "أرسل اسمك أو رقم مرجع التحويل.", en: "Send your name or the transfer reference." },
  purchaseSubmitted: {
    ar: "✅ تم إرسال طلبك للمراجعة. بعد التحقق من التحويل سيصلك كود التفعيل وخطوات إنشاء بوتك خلال 24 ساعة.",
    en: "✅ Your request has been sent for review. Once your transfer is verified, you'll receive an activation code and setup steps within 24 hours.",
  },
};

export function t(lang: Lang, key: keyof typeof STR, vars?: Record<string, string | number>): string {
  let s = STR[key]?.[lang] ?? STR[key]?.ar ?? String(key);
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  }
  return s;
}
