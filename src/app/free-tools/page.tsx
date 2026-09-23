import { permanentRedirect } from "next/navigation";

// Retired 2026-09-23 (owner): it duplicated the homepage's free-tools
// section exactly. Old links, bookmarks and Telegram posts land on that
// section instead of a 404. The individual tools under /free-tools/* stay.
export default function FreeToolsIndex() {
  permanentRedirect("/#free-tools");
}
