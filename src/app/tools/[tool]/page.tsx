import { permanentRedirect } from "next/navigation";

// Retired studio tools (see ../page.tsx).
export default function ToolRedirect() {
  permanentRedirect("/free-tools");
}
