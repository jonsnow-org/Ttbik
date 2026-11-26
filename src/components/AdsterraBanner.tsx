"use client";

import { useEffect, useRef, useState } from "react";
import { adsterraKeyFor } from "@/lib/adsterraKeys";

/**
 * Adsterra "iframe" format banner (the atOptions technique). Rendered
 * inside an isolated iframe via srcDoc rather than injected straight into
 * the page, for two reasons:
 *
 * 1. Adsterra's snippet sets a global `atOptions` that its invoke.js reads
 *    on load. This site can show more than one ad unit on the same page
 *    at once (header + footer + one or two in-content slots) — two
 *    directly-injected units would stomp each other's `atOptions` before
 *    the slower one's invoke.js runs. An iframe gives each unit its own
 *    isolated `window`, so that can't happen.
 * 2. It sidesteps a real bug the placeholder path this replaces would
 *    have hit the moment real code was dropped into it: a `<script>` tag
 *    written via `dangerouslySetInnerHTML` never executes — browsers only
 *    run scripts parsed from real HTML, not ones assigned via innerHTML.
 *    `srcDoc` is parsed as a real HTML document, so the script actually
 *    runs.
 */
// Units that answered with no creative at all (refused, blocked, or simply no
// fill) for the rest of this page session. The network is asked ONCE per unit
// per page load, never in a retry loop: the live mini-app console on 2026-11-26
// showed the same refused invoke.js four times in a single page load — two
// slots, each reloading twice — which is a request loop, not a fallback.
const EMPTY_UNITS = new Set<string>();

/** How long a frame is given to receive a creative before the unit is counted as empty. */
const FILL_WAIT_MS = 6000;

export default function AdsterraBanner({ adKey, width, height, reloadKey = 0, onEmpty }: { adKey: string; width: number; height: number; reloadKey?: number; onEmpty?: () => void }) {
  // Ad networks sometimes answer with nothing (no fill / slow script). The
  // frame is same-origin (srcDoc), so we can see whether the network actually
  // put a creative inside it; if it did not, the slot disappears quietly and
  // the unit is not asked again this session. A new reloadKey (pull-to-refresh)
  // is the one thing that asks an empty unit again.
  const ref = useRef<HTMLIFrameElement>(null);
  // the unit key depends on the address the page is served from (lib/adsterraKeys.ts); until the browser tells us, nothing is requested
  const [host, setHost] = useState<string | null>(null);
  useEffect(() => { setHost(window.location.hostname); }, []);
  const unitKey = host === null ? null : adsterraKeyFor(host, adKey);
  // parents pass an inline arrow here; keeping it in a ref stops it from
  // re-arming the effects (and re-requesting the ad) on every parent render
  const onEmptyRef = useRef(onEmpty);
  useEffect(() => { onEmptyRef.current = onEmpty; }, [onEmpty]);
  const [hidden, setHidden] = useState(false);
  const lastReload = useRef(reloadKey);

  useEffect(() => { if (host !== null && unitKey === null) onEmptyRef.current?.(); }, [host, unitKey]);
  // an empty unit stays hidden; only an explicit refresh clears it
  useEffect(() => {
    if (!unitKey) return;
    if (!EMPTY_UNITS.has(unitKey)) return;
    setHidden(true);
    onEmptyRef.current?.();
  }, [unitKey]);
  useEffect(() => {
    if (reloadKey === lastReload.current) return;
    lastReload.current = reloadKey;
    if (unitKey) EMPTY_UNITS.delete(unitKey);
    setHidden(false);
  }, [reloadKey, unitKey]);

  useEffect(() => {
    if (!unitKey || hidden) return;
    const t = setTimeout(() => {
      let filled = true;
      try {
        const body = ref.current?.contentDocument?.body;
        if (body) {
          const nodes = Array.from(body.querySelectorAll("iframe, img, ins, a, canvas, object, video"));
          filled = nodes.some((n) => {
            if (n.tagName !== "VIDEO") return true;
            const v = n as HTMLVideoElement;
            return !!(v.currentSrc || v.getAttribute("src") || v.querySelector("source"));
          });
        }
      } catch {
        /* cross-origin: cannot inspect — leave it as it is (no second request) */
        return;
      }
      if (filled) return;
      EMPTY_UNITS.add(unitKey);
      setHidden(true);
      onEmptyRef.current?.();
    }, FILL_WAIT_MS);
    return () => clearTimeout(t);
  }, [unitKey, hidden, reloadKey]);

  if (unitKey === null || hidden) return <div style={{ width, height }} aria-hidden />;
  const html = `<!DOCTYPE html><html><head><style>html,body{margin:0;padding:0;overflow:hidden}</style></head><body>
<script>
  atOptions = {
    'key': '${unitKey}',
    'format': 'iframe',
    'height': ${height},
    'width': ${width},
    'params': {}
  };
</script>
<script src="https://www.highrevenueformat.com/${unitKey}/invoke.js"></script>
</body></html>`;

  return (
    <iframe
      ref={ref}
      key={`${reloadKey}-${unitKey}`}
      srcDoc={html}
      width={width}
      height={height}
      style={{ border: 0, display: "block" }}
      scrolling="no"
      title="إعلان"
    />
  );
}
