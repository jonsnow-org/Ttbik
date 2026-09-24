// Owner decision 2026-09-24: Nova is paused until further notice. Nothing on
// Vercel calls the Nova backend on Render while this is true (so it is never
// woken up), the Nova bot answers with a short notice, other bots hide their
// «اسأل نوفا» buttons, and no new Nova subscription can be bought.
// Set to false to bring Nova back.
export const NOVA_PAUSED = true;

export const NOVA_PAUSED_TEXT = "⏸️ «نوفا» متوقف مؤقتاً. سنعلن عودته قريباً إن شاء الله.";
