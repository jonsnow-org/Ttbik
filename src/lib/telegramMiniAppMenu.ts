export const MINI_APP_MENU_LABEL = "📱 التطبيق";

export type ChatMiniAppMenuApi = {
  setChatMenuButton: (args: {
    chat_id: number;
    menu_button: {
      type: "web_app";
      text: string;
      web_app: { url: string };
    };
  }) => Promise<unknown>;
};

/**
 * Sets a Mini App as the persistent menu button for one private chat.
 * Telegram only supports one menu button per chat, so this is deliberately
 * chat-scoped (never a global bot setting) for bots that host many user apps.
 */
export async function setChatMiniAppMenu(
  api: ChatMiniAppMenuApi,
  chatId: number,
  url: string,
  text = MINI_APP_MENU_LABEL,
): Promise<boolean> {
  if (!Number.isSafeInteger(chatId) || chatId <= 0) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return false;
    await api.setChatMenuButton({
      chat_id: chatId,
      menu_button: {
        type: "web_app",
        text: text.slice(0, 64),
        web_app: { url: parsed.toString() },
      },
    });
    return true;
  } catch {
    // Telegram failures are deliberately not cached: the next start,
    // app creation, or app selection can retry the registration.
    return false;
  }
}
