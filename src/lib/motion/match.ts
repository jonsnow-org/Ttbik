// «رموز» matching: turns a scene code into weighted English concept words,
// asks the footage store for real clips, and picks the best one with a
// weighted cosine similarity between what the scene needs and what each clip
// shows:
//
//   score(clip) = Σ wᵢ·[termᵢ ∈ clip] / (‖w‖ · √|clip words|)
//               + 0.15·portrait + 0.10·min(1, clip seconds / scene seconds)
//               − 0.60·already used in the story
//
// The subject weighs most (3), then the action (2), the place (1.5), time and
// weather (1), things in the scene (0.7) and colour (0.5).
import type { Action, Kind, Place, SceneCode, Time, Weather } from "./brain";
import { symbolInfo } from "./lexicon";

export type Clip = {
  id: number;
  kind: "video" | "photo";
  words: string;
  url: string;
  poster: string;
  w: number;
  h: number;
  dur: number;
  author: string;
  authorUrl: string;
  page: string;
};

const KIND_EN: Record<Kind, string> = { cat: "cat", dog: "dog", rabbit: "rabbit", bird: "bird", butterfly: "butterfly", fish: "fish", person: "person", child: "child", car: "car", ball: "ball" };
const ACTION_EN: Record<Action, string> = {
  idle: "", walk: "walking", run: "running", chase: "chasing", play: "playing", jump: "jumping", fly: "flying", swim: "swimming", sleep: "sleeping", laugh: "laughing", eat: "eating", dance: "dancing", sit: "sitting", look: "looking",
};
const PLACE_EN: Record<Place, string> = { field: "meadow", forest: "forest", garden: "garden", sea: "sea beach", river: "river", desert: "desert", city: "city street", house: "home", mountain: "mountains", space: "space" };
const TIME_EN: Record<Time, string> = { morning: "sunrise", day: "", sunset: "sunset", night: "night" };
const WEATHER_EN: Record<Weather, string> = { clear: "", clouds: "cloudy", rain: "rain", snow: "snow", wind: "wind" };
const COLOR_EN: Record<string, string> = {
  "#f8f6f0": "white", "#2b2b30": "black", "#f0913a": "orange", "#9aa0a8": "gray", "#8a5a36": "brown", "#e8b93c": "yellow", "#e0453a": "red", "#3a7be0": "blue", "#3fae5a": "green", "#f39ac4": "pink",
};

const STOP = new Set(["a", "an", "the", "of", "with", "in", "on", "and", "to", "at", "from", "is", "are", "for", "by", "its", "their", "up", "down"]);

/** Crude English stem so "cats"/"cat" and "playing"/"plays" meet. */
export function stem(w: string) {
  let x = w.toLowerCase().replace(/[^a-z]/g, "");
  if (x.length > 5 && x.endsWith("ing")) x = x.slice(0, -3);
  else if (x.length > 4 && x.endsWith("ies")) x = x.slice(0, -3) + "y";
  else if (x.length > 3 && x.endsWith("es") && /(s|x|ch|sh)es$/.test(x)) x = x.slice(0, -2);
  else if (x.length > 3 && x.endsWith("s") && !x.endsWith("ss")) x = x.slice(0, -1);
  return x;
}
const wordsOf = (text: string) => text.split(/\s+/).map(stem).filter((w) => w.length > 1 && !STOP.has(w));

function subjectEn(s: SceneCode) {
  const a = s.actors[0];
  if (!a) return "";
  return a.kind === "sym" ? symbolInfo(a.sym ?? 0).en : KIND_EN[a.kind];
}

export type Need = { terms: Map<string, number>; queries: string[] };

/** What a scene needs: weighted words, and search queries from most to least specific. */
export function needOf(s: SceneCode): Need {
  const terms = new Map<string, number>();
  const put = (text: string, w: number) => {
    const ws = wordsOf(text);
    ws.forEach((x) => terms.set(x, Math.max(terms.get(x) || 0, w / Math.sqrt(ws.length))));
  };
  const subject = subjectEn(s);
  const a = s.actors[0];
  const action = a ? ACTION_EN[a.action] : "";
  const place = PLACE_EN[s.place];
  const time = TIME_EN[s.time];
  const weather = WEATHER_EN[s.weather];
  const color = a?.color ? COLOR_EN[a.color] || "" : "";
  const props = s.props.map((p) => symbolInfo(p.sym).en).slice(0, 2);
  const target = s.target ? (s.target.kind === "sym" ? symbolInfo(s.target.sym ?? 0).en : KIND_EN[s.target.kind]) : "";
  put(subject, 3);
  put(action, 2);
  put(place, 1.5);
  put(time, 1);
  put(weather, 1);
  put(target, 1);
  props.forEach((p) => put(p, 0.7));
  put(color, 0.5);
  const q = (...parts: string[]) => parts.filter(Boolean).join(" ").trim();
  const queries = [
    // a scene of the place itself: search the landscape with its light and weather
    ...(subject ? [] : [q(place, weather, time), q(place, time), q(place)]),
    q(color, subject, action, target || place.split(" ")[0], time || weather),
    q(subject, action, place.split(" ")[0]),
    q(subject, action),
    q(subject),
    q(props[0], place.split(" ")[0], time),
  ].filter((x, i, all) => x && all.indexOf(x) === i);
  return { terms, queries };
}

export function score(clip: Clip, need: Need, sceneSeconds: number, used: Set<number>) {
  const cw = new Set(wordsOf(clip.words));
  let dot = 0;
  let norm = 0;
  need.terms.forEach((w, t) => {
    norm += w * w;
    if (cw.has(t)) dot += w;
  });
  const cosine = norm && cw.size ? dot / (Math.sqrt(norm) * Math.sqrt(cw.size)) : 0;
  const portrait = clip.h > clip.w ? 1 : 0;
  const length = clip.kind === "video" ? Math.min(1, clip.dur / sceneSeconds) : 0.4;
  return cosine + 0.15 * portrait + 0.1 * length - (used.has(clip.id) ? 0.6 : 0);
}

/** Ranks every candidate for every scene; each scene gets its best unused clip first. */
export function rankScenes(scenes: SceneCode[], pools: Clip[][], sceneSeconds: number): Clip[][] {
  const used = new Set<number>();
  return scenes.map((s, i) => {
    const need = needOf(s);
    const seen = new Set<number>();
    const ranked = pools[i]
      .filter((c) => !seen.has(c.id) && seen.add(c.id))
      .map((c) => ({ c, v: score(c, need, sceneSeconds, used) }))
      .sort((a, b) => b.v - a.v)
      .map((x) => x.c);
    if (ranked[0]) used.add(ranked[0].id);
    return ranked;
  });
}

export async function fetchPools(scenes: SceneCode[]): Promise<{ pools: Clip[][]; error?: string }> {
  const needs = scenes.map(needOf);
  const queries = [...new Set(needs.flatMap((n) => n.queries))].slice(0, 16);
  const res = await fetch("/api/tools/clips", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ queries }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { pools: scenes.map(() => []), error: data.error || "unavailable" };
  const results = (data.results || {}) as Record<string, Clip[]>;
  const norm = (q: string) => q.toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
  return { pools: needs.map((n) => n.queries.flatMap((q) => results[norm(q)] || [])) };
}
