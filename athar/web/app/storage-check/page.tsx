"use client";
import { useState } from "react";
import { buildItem, isReadable, uploadItem } from "@/lib/storage";

// A one-tap check that THIS browser, on THIS network, can store a file permanently (route 1 of the failure plan).
// It stores a tiny unique test file (about 1 KB), so it uses almost none of the free allowance.
export default function StorageCheck() {
  const [out, setOut] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const log = (l: string) => setOut((o) => [...o, l]);
  async function run() {
    setBusy(true); setOut([]);
    try {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#d4a017"/><!--athar storage check ${Date.now()}-${Math.random()}--></svg>`;
      const item = await buildItem(svg);
      log(`id: ${item.id}`);
      const up = await uploadItem(item);
      log(up.ok ? `upload: OK via ${up.via}` : `upload: FAILED (${up.error})`);
      if (up.ok) {
        let ok = false;
        for (let i = 0; i < 5 && !ok; i++) { ok = await isReadable(item.id); if (!ok) await new Promise((r) => setTimeout(r, 1500)); }
        log(ok ? "read back: OK" : "read back: not yet (the server would keep trying)");
        log(ok ? "RESULT: route 1 works on this network" : "RESULT: uploaded but not readable yet");
      } else log("RESULT: route 1 does not work on this network; route 2 (our server) would take over");
    } catch (e) { log("ERROR: " + String(e)); }
    setBusy(false);
  }
  return (
    <div className="card" style={{ marginTop: 20 }}>
      <h3>Storage check</h3>
      <p className="muted">One tap: tries to store a tiny test file permanently from this browser.</p>
      <button className="btn gold" disabled={busy} onClick={run}>{busy ? "…" : "Run check"}</button>
      <pre dir="ltr" style={{ whiteSpace: "pre-wrap", marginTop: 12 }}>{out.join("\n")}</pre>
    </div>
  );
}
