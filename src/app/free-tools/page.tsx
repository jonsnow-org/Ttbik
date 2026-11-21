import { permanentRedirect } from "next/navigation";

// The catalog lives at /tools. Old /free-tools links (bookmarks, Telegram) land there.
// Individual tools stay at /free-tools/<slug>.
export default function FreeToolsIndex() {
  permanentRedirect("/tools");
}
