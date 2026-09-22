"use client";

import StudioGate from "./StudioGate";
import AudioVisualizerStudio from "@/components/studio/AudioVisualizerStudio";
import type { StudioToolProps } from "./StudioGate";

const STUDIO_COMPONENTS: Record<string, React.ComponentType<StudioToolProps>> = {
  "audio-visualizer": AudioVisualizerStudio,
};

// Real bug fixed 2026-09-22 (owner report: /tools/audio-visualizer was a
// blank page, HTTP 500 -- "An error occurred in the Server Components
// render"): page.tsx used to build <StudioGate>{(props) => <StudioComponent
// {...props} />}</StudioGate> itself. page.tsx has no "use client", so
// that render-prop function -- and, just as broken, any inline function
// prop on a JSX element constructed there -- was a plain closure created
// in Server Component code, which React Server Components cannot
// serialize across the server/client boundary. Moving the entire
// STUDIO_COMPONENTS lookup + StudioGate composition into this client
// component fixes it for real: everything here runs client-side, so the
// render-prop pattern never has to cross that boundary. page.tsx now only
// passes plain serializable values in (strings/booleans).
export default function ToolPageClient({
  tool,
  serviceHref,
  freeUses,
  initialOrderCode,
  isOwner,
}: {
  tool: string;
  serviceHref: string;
  freeUses: number;
  initialOrderCode: string;
  isOwner: boolean;
}) {
  const StudioComponent = STUDIO_COMPONENTS[tool];
  if (!StudioComponent) return null;

  return (
    <StudioGate tool={tool} serviceHref={serviceHref} freeUses={freeUses} initialOrderCode={initialOrderCode} isOwner={isOwner}>
      {(studioProps) => <StudioComponent {...studioProps} />}
    </StudioGate>
  );
}
