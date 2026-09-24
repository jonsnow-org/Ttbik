// «رموز» part 2: packs a whole storyboard into one short code (a few dozen
// characters per scene) and back. The code IS the video: pasting it re-renders
// exactly the same scenes, so a video can be saved, shared or edited as text.
import { ALL_ACTIONS, ALL_KINDS, ALL_PLACES, ALL_TIMES, ALL_WEATHERS, MAX_SCENES, type Actor, type SceneCode } from "./brain";

const VERSION = "R1";

function toB64Url(s: string) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64Url(s: string) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

const idx = (list: readonly string[], v: string) => Math.max(0, list.indexOf(v)).toString(36);
const at = <T,>(list: readonly T[], c: string | undefined, fallback: T): T => list[parseInt(c || "", 36)] ?? fallback;

function packActor(a: Actor) {
  const size = a.size < 0.95 ? "s" : a.size > 1.05 ? "b" : "m";
  return `${idx(ALL_KINDS, a.kind)}${Math.min(6, Math.max(1, a.count))}${idx(ALL_ACTIONS, a.action)}${size}${a.color ? a.color.slice(1) : ""}`;
}

function unpackActor(s: string): Actor | null {
  if (s.length < 4) return null;
  const color = s.slice(4);
  return {
    kind: at(ALL_KINDS, s[0], "cat"),
    count: Math.min(6, Math.max(1, Number(s[1]) || 1)),
    action: at(ALL_ACTIONS, s[2], "walk"),
    size: s[3] === "s" ? 0.8 : s[3] === "b" ? 1.25 : 1,
    color: /^[0-9a-f]{6}$/i.test(color) ? `#${color}` : undefined,
  };
}

export function encodeStory(scenes: SceneCode[]): string {
  const body = scenes
    .map((s) =>
      [
        `${idx(ALL_PLACES, s.place)}${idx(ALL_TIMES, s.time)}${idx(ALL_WEATHERS, s.weather)}`,
        s.actors.map(packActor).join(","),
        s.target ? idx(ALL_KINDS, s.target) : "",
        s.caption.replace(/[|\n]/g, " "),
      ].join("|"),
    )
    .join("\n");
  return `${VERSION}.${toB64Url(body)}`;
}

export function decodeStory(code: string): SceneCode[] | null {
  const m = code.trim().match(/^R1\.([A-Za-z0-9_-]+)$/);
  if (!m) return null;
  try {
    const scenes = fromB64Url(m[1])
      .split("\n")
      .slice(0, MAX_SCENES)
      .map((line): SceneCode | null => {
        const [env = "", actors = "", target = "", caption = ""] = line.split("|");
        const list = actors.split(",").map(unpackActor).filter((a): a is Actor => !!a).slice(0, 3);
        if (!list.length) return null;
        return {
          place: at(ALL_PLACES, env[0], "field"),
          time: at(ALL_TIMES, env[1], "day"),
          weather: at(ALL_WEATHERS, env[2], "clear"),
          actors: list,
          target: target ? at(ALL_KINDS, target, "ball") : undefined,
          caption: caption.slice(0, 80),
        };
      })
      .filter((s): s is SceneCode => !!s);
    return scenes.length ? scenes : null;
  } catch {
    return null;
  }
}
