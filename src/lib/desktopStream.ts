// The graphical desktop view can show a live screen stream or fall back to the slower screenshot poll.
// The stream is a 20-second SSE call that reconnects right away; a naive `streaming` boolean flips to
// "fallback" during every reconnect, so the status line under the screen blinked between the two words.
// This keeps the label stable while a reconnect is in flight.

export type DesktopStreamMode = "stopped" | "live" | "reconnecting" | "snapshot";

export type DesktopStreamInput = {
  running: boolean;      // a desktop session is up in the Studio
  streaming: boolean;    // a live stream call is open right now
  lastStreamAt: number;  // when a stream event last arrived (ms, 0 = never)
  now: number;
  graceMs?: number;      // how long a reconnect may take before the label changes
};

/** The status word for the desktop screen: live, briefly reconnecting, or the fallback poll. */
export function desktopStreamMode(input: DesktopStreamInput): DesktopStreamMode {
  if (!input.running) return "stopped";
  if (input.streaming) return "live";
  const grace = input.graceMs ?? 12_000;
  if (input.lastStreamAt && input.now - input.lastStreamAt < grace) return "reconnecting";
  return "snapshot";
}
