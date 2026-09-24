/**
 * Registry for "studio" tools: real, self-contained interactive tools (audio/
 * video/image processing that runs entirely in the visitor's browser) sold
 * as permanent access via the same order-code gate as the AI tools, but
 * without any AI/Groq call — the tool itself does the work client-side.
 *
 * freeUses (owner directive, 2026-09-20): a visitor who lands on the page
 * directly had no way to know an order code even existed, let alone how to
 * get one -- pure "enter a code or nothing" was a dead end for anyone who
 * hadn't already paid blind. Since these tools cost nothing extra to run
 * (all processing is client-side, no server/AI spend per use), letting
 * anyone try the real tool a few times before asking for payment is free
 * to offer and lets them see the result before buying. Tracked client-side
 * (localStorage) via StudioGate -- not a hard security boundary, just a
 * normal soft freemium limit, same as any browser-only free tool here.
 */
export const STUDIO_TOOL_LABELS: Record<string, { title: string; freeUses: number }> = {
  "story-video": { title: "صانع الفيديو المتحرك من الوصف", freeUses: 3 },
  "audio-visualizer": { title: "استوديو تحويل الصوت إلى فيديو ريلز", freeUses: 2 },
};

export type StudioToolKey = keyof typeof STUDIO_TOOL_LABELS;
