"use client";

import { useEffect, useRef, useState } from "react";

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
export default function AdsterraBanner({ adKey, width, height, reloadKey = 0, onEmpty }: { adKey: string; width: number; height: number; reloadKey?: number; onEmpty?: () => void }) {
  // Ad networks sometimes answer with nothing (no fill / slow script). The
  // frame is same-origin (srcDoc), so we can see whether the network actually
  // put a creative inside it; if not, reload it a few times instead of
  // leaving an empty box. A new reloadKey (pull-to-refresh) also reloads it.
  const [attempt, setAttempt] = useState(0);
  const ref = useRef<HTMLIFrameElement>(null);
  useEffect(() => { setAttempt(0); }, [reloadKey]);
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const body = ref.current?.contentDocument?.body;
        if (!body) return;
        const nodes = Array.from(body.querySelectorAll("iframe, img, ins, a, canvas, object, video"));
        const filled = nodes.some((n) => {
          if (n.tagName !== "VIDEO") return true;
          const v = n as HTMLVideoElement;
          return !!(v.currentSrc || v.getAttribute("src") || v.querySelector("source"));
        });
        if (filled) return;
        if (attempt < 2) setAttempt((a) => a + 1);
        else onEmpty?.();
      } catch {
        /* cross-origin: cannot inspect, leave as is */
      }
    }, 4000 + attempt * 1200);
    return () => clearTimeout(t);
  }, [attempt, reloadKey, onEmpty]);

  const html = `<!DOCTYPE html><html><head><style>html,body{margin:0;padding:0;overflow:hidden}</style></head><body>
<script>
  atOptions = {
    'key': '${adKey}',
    'format': 'iframe',
    'height': ${height},
    'width': ${width},
    'params': {}
  };
</script>
<script src="https://www.highrevenueformat.com/${adKey}/invoke.js"></script>
</body></html>`;

  return (
    <iframe
      ref={ref}
      key={`${reloadKey}-${attempt}`}
      srcDoc={html}
      width={width}
      height={height}
      style={{ border: 0, display: "block" }}
      scrolling="no"
      title="إعلان"
    />
  );
}
