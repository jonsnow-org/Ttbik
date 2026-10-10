// The standalone living token viewer: one HTML file, no server. Kept permanently (Arweave) and mirrored, so a token's moving picture
// can always be shown from the token's own numbers:  viewer.html#i=<date index>&t=<kind 0..7>&s=<season>&g=<age stage>&h=<hands>&e=<engravings>&o=<occasion>
import { renderArt } from "../lib/art";
import { liveArt } from "../lib/live";
import { ymd } from "../lib/dates";

const q = new URLSearchParams(location.hash.replace(/^#/, "") || location.search);
const n = (k: string, d = 0) => { const v = Number(q.get(k)); return Number.isFinite(v) && q.get(k) !== null ? v : d; };
const index = Math.max(0, Math.min(36524, Math.floor(n("i"))));
const { m, d } = ymd(index);
const now = new Date();
const art = { index, tier: Math.min(7, Math.max(0, n("t"))), season: n("s", 1), stage: Math.min(4, Math.max(0, n("g"))), hands: Math.min(60, Math.max(0, n("h", 1))), engravings: Math.min(99, Math.max(0, n("e"))), occasion: Math.min(9, Math.max(0, n("o"))) };
document.getElementById("t")!.innerHTML = liveArt(renderArt(art), { stage: art.stage, tier: art.tier, anniversary: now.getMonth() + 1 === m && now.getDate() === d });
