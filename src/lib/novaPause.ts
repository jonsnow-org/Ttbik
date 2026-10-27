// Owner decision 2026-09-24: the LEGACY Nova backend (the FastAPI service on Render + its crypto-invoice / dashboard / assist endpoints) is paused.
// Nothing on Vercel calls it while this is true, so it is never woken up.
//
// 2026-10-28 (B-09): this flag used to be called NOVA_PAUSED and was ALSO read as "the coder engine (today's Nova) is the bot's handler"
// (src/app/api/telegram/[botId]/route.ts) and as "Nova cannot be bought". Flipping it to false therefore sent every update — Nova's own — to the Sham
// handler. It now means exactly one thing: the legacy Render backend and the endpoints that depend on it are off. It never decides which model answers
// a chat (that is the chat's own `model`, src/lib/coderSections.ts) and it never blocks buying Nova's plans in the bot (Telegram Stars, src/lib/coderStars.ts).
// Set to false only when the legacy backend is really back.
export const NOVA_LEGACY_BACKEND_PAUSED = true;

export const NOVA_LEGACY_PAUSED_TEXT = "⏸️ خدمة «نوفا» القديمة (الخادم الخارجي) متوقفة مؤقتاً. اشتراكات نوفا الجديدة تتم من داخل البوت (نجوم تيليجرام).";

/** Does the legacy backend (Render FastAPI) get called? */
export const novaLegacyBackendOn = (): boolean => !NOVA_LEGACY_BACKEND_PAUSED;
