import { permanentRedirect } from "next/navigation";

// The studio tools were retired (owner decision, 2026-09-25) — old links
// land on the free tools instead of a 404.
export default function ToolsRedirect() {
  permanentRedirect("/free-tools");
}
