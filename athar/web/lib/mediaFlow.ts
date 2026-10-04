// Browser side of the failure plan: the picture must be safe before any money is taken for it.
//   route 1  this browser uploads it straight to the free permanent network (the user's own network quota), then reads it back
//   route 2  if that fails, our server takes it, keeps a copy, tries from its own network, and keeps trying in the background
//   neither  only if even our server cannot be reached: nothing was bound to the token and nothing is charged for the picture
// Either way the id is final from the start (it comes from the content), so a token can be minted carrying it.
import { buildItem, isReadable, uploadItem } from "./storage";

export type Persisted = { state: "stored" | "queued" | "failed"; ref: bigint; id: string };

export async function persistPicture(svg: string): Promise<Persisted> {
  const item = await buildItem(svg);
  try {
    const up = await uploadItem(item);
    if (up.ok) {
      for (let i = 0; i < 4; i++) { if (await isReadable(item.id)) return { state: "stored", ref: item.ref, id: item.id }; await new Promise((r) => setTimeout(r, 1500)); }
    }
  } catch { /* fall through to route 2 */ }
  try {
    const r = await fetch("/api/media/queue", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ svg }) });
    if (r.ok) {
      const j = await r.json();
      return { state: j.readable ? "stored" : "queued", ref: BigInt(j.ref), id: j.id };
    }
  } catch { /* server unreachable */ }
  return { state: "failed", ref: 0n, id: item.id };
}
