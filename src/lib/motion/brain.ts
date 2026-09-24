// «رموز» — the small brain. It reads a description word by word through the
// letter-code model (lexicon.ts): each word is walked letter by letter until
// it lands on a symbol. Engine words (motions, places, times, weather,
// colours, sizes, numbers and the creatures we animate ourselves) live in the
// same model as the library symbols. Then the words of each sentence are put
// together into scene codes that the renderer turns into motion.
import { letterModel, normalize, symbolInfo, type Hit } from "./lexicon";

export type Kind = "cat" | "dog" | "rabbit" | "bird" | "butterfly" | "fish" | "person" | "child" | "car" | "ball";
export type Action = "idle" | "walk" | "run" | "chase" | "play" | "jump" | "fly" | "swim" | "sleep" | "laugh" | "eat" | "dance" | "sit" | "look";
export type Place = "field" | "forest" | "garden" | "sea" | "river" | "desert" | "city" | "house" | "mountain" | "space";
export type Time = "morning" | "day" | "sunset" | "night";
export type Weather = "clear" | "clouds" | "rain" | "snow" | "wind";

/** kind "sym" = a library symbol (index into SYMBOLS); the others are drawn by our own code. */
export type Actor = { kind: Kind | "sym"; sym?: number; count: number; action: Action; color?: string; size: number };
export type Prop = { sym: number };
export type SceneCode = {
  place: Place;
  time: Time;
  weather: Weather;
  actors: Actor[]; // actors[0] is the subject
  target?: { kind: Kind | "sym"; sym?: number };
  props: Prop[];
  caption: string;
};

// ---------------------------------------------------------------- engine words

const KINDS: { kind: Kind; words: string[]; plural?: string[]; dual?: string[] }[] = [
  { kind: "cat", words: ["قط", "قطه", "هر", "هره", "بسه", "قطيطه", "cat", "kitten", "kitty"], plural: ["قطط", "cats", "kittens"], dual: ["قطتان", "قطتين"] },
  { kind: "dog", words: ["كلب", "كلبه", "جرو", "dog", "puppy"], plural: ["كلاب", "جراء", "dogs", "puppies"], dual: ["كلبان", "كلبين"] },
  { kind: "rabbit", words: ["ارنب", "ارنبه", "rabbit", "bunny"], plural: ["ارانب", "rabbits"] },
  { kind: "bird", words: ["عصفور", "عصفوره", "طاير", "طير", "bird", "sparrow"], plural: ["طيور", "عصافير", "birds"] },
  { kind: "butterfly", words: ["فراشه", "butterfly"], plural: ["فراشات", "butterflies"] },
  { kind: "fish", words: ["سمكه", "سمك", "fish"], plural: ["اسماك", "fishes"] },
  { kind: "child", words: ["طفل", "طفله", "ولد", "بنت", "صبي", "فتاه", "child", "kid", "boy", "girl"], plural: ["اطفال", "اولاد", "بنات", "children", "kids"] },
  { kind: "person", words: ["رجل", "امراه", "شاب", "شخص", "انسان", "man", "woman", "person"], plural: ["ناس", "رجال", "نساء", "اشخاص", "people"] },
  { kind: "car", words: ["سياره", "car"], plural: ["سيارات", "cars"] },
  { kind: "ball", words: ["كره", "ball"], plural: ["كرات", "balls"] },
];

const ACTIONS: { action: Action; stems: string[] }[] = [
  { action: "chase", stems: ["طارد", "مطارد", "لاحق", "ملاحق", "chase"] },
  { action: "play", stems: ["لعب", "العب", "play"] },
  { action: "run", stems: ["ركض", "جري", "جرى", "run", "race", "drive"] },
  { action: "walk", stems: ["مشي", "مشى", "تجول", "سير", "سار", "walk", "stroll"] },
  { action: "jump", stems: ["قفز", "نط", "jump", "hop"] },
  { action: "fly", stems: ["طير", "طار", "حلق", "fly", "flying"] },
  { action: "swim", stems: ["سبح", "سباح", "swim", "sail"] },
  { action: "sleep", stems: ["نام", "نوم", "نايم", "رتاح", "ستريح", "استراح", "استراحه", "راحه", "غفو", "sleep", "rest", "nap"] },
  { action: "laugh", stems: ["ضحك", "فرح", "سعيد", "مبتسم", "بتسم", "laugh", "happy", "smile"] },
  { action: "eat", stems: ["اكل", "كل", "طعام", "شرب", "eat", "drink"] },
  { action: "dance", stems: ["رقص", "dance"] },
  { action: "sit", stems: ["جلس", "جالس", "جلوس", "قعد", "sit"] },
  { action: "look", stems: ["نظر", "تامل", "شاهد", "راقب", "look", "watch", "gaze"] },
];

const PLACES: { place: Place; words: string[] }[] = [
  { place: "forest", words: ["غابه", "غابات", "اشجار", "forest", "woods", "jungle"] },
  { place: "garden", words: ["حديقه", "حدايق", "بستان", "منتزه", "garden", "park"] },
  { place: "sea", words: ["بحر", "شاطي", "شط", "موج", "امواج", "محيط", "sea", "beach", "ocean"] },
  { place: "river", words: ["نهر", "بحيره", "بركه", "river", "lake", "pond"] },
  { place: "desert", words: ["صحرا", "صحراء", "رمال", "كثبان", "desert", "dunes"] },
  { place: "city", words: ["مدينه", "مدن", "شارع", "شوارع", "سوق", "اسواق", "city", "street", "town", "market"] },
  { place: "house", words: ["بيت", "منزل", "غرفه", "داخل", "house", "home", "room"] },
  { place: "mountain", words: ["جبل", "جبال", "قمه", "mountain", "mountains", "hill"] },
  { place: "space", words: ["فضاء", "فضا", "كواكب", "كوكب", "space", "planet"] },
  { place: "field", words: ["حقل", "حقول", "مرج", "مروج", "عشب", "مزرعه", "ريف", "field", "meadow", "farm"] },
];

const TIMES: { time: Time; words: string[] }[] = [
  { time: "night", words: ["ليل", "ليلا", "ليله", "مساء", "night"] },
  { time: "sunset", words: ["غروب", "شفق", "مغرب", "sunset", "dusk"] },
  { time: "morning", words: ["صباح", "صباحا", "فجر", "شروق", "morning", "dawn", "sunrise"] },
  { time: "day", words: ["نهار", "ظهر", "مشمس", "day", "noon", "sunny"] },
];

const WEATHERS: { weather: Weather; words: string[] }[] = [
  { weather: "rain", words: ["مطر", "امطار", "ممطر", "rain", "rainy"] },
  { weather: "snow", words: ["ثلج", "ثلوج", "مثلج", "snow", "snowy"] },
  { weather: "wind", words: ["ريح", "رياح", "عاصفه", "wind", "windy", "storm"] },
  { weather: "clouds", words: ["غيوم", "سحاب", "غيم", "clouds", "cloudy"] },
];

const COLORS: { color: string; words: string[] }[] = [
  { color: "#f8f6f0", words: ["ابيض", "بيضاء", "بيضا", "بيضاوان", "بيضاوين", "white"] },
  { color: "#2b2b30", words: ["اسود", "سوداء", "سودا", "سوداوان", "black"] },
  { color: "#f0913a", words: ["برتقالي", "برتقاليه", "orange"] },
  { color: "#9aa0a8", words: ["رمادي", "رماديه", "gray", "grey"] },
  { color: "#8a5a36", words: ["بني", "بنيه", "brown"] },
  { color: "#e8b93c", words: ["ذهبي", "ذهبيه", "اصفر", "صفراء", "golden", "yellow"] },
  { color: "#e0453a", words: ["احمر", "حمراء", "red"] },
  { color: "#3a7be0", words: ["ازرق", "زرقاء", "blue"] },
  { color: "#3fae5a", words: ["اخضر", "خضراء", "green"] },
  { color: "#f39ac4", words: ["وردي", "ورديه", "pink"] },
];

const SIZES: { size: number; words: string[] }[] = [
  { size: 0.8, words: ["صغير", "صغيره", "صغار", "little", "small", "baby", "tiny"] },
  { size: 1.25, words: ["كبير", "كبيره", "ضخم", "big", "huge"] },
];
const NUMBERS: Record<string, number> = { اثنان: 2, اثنين: 2, ثلاث: 3, ثلاثه: 3, اربع: 4, اربعه: 4, خمس: 5, خمسه: 5, two: 2, three: 3, four: 4, five: 5 };

const model = () =>
  letterModel((m) => {
    for (const k of KINDS) {
      k.words.forEach((w) => m.insertTag(w, `k:${k.kind}:1`));
      k.plural?.forEach((w) => m.insertTag(w, `k:${k.kind}:3`));
      k.dual?.forEach((w) => m.insertTag(w, `k:${k.kind}:2`));
    }
    ACTIONS.forEach((a) => a.stems.forEach((w) => m.insertTag(w, `a:${a.action}`)));
    PLACES.forEach((p) => p.words.forEach((w) => m.insertTag(w, `p:${p.place}`)));
    TIMES.forEach((t) => t.words.forEach((w) => m.insertTag(w, `t:${t.time}`)));
    WEATHERS.forEach((x) => x.words.forEach((w) => m.insertTag(w, `w:${x.weather}`)));
    COLORS.forEach((c) => c.words.forEach((w) => m.insertTag(w, `c:${c.color}`)));
    SIZES.forEach((s) => s.words.forEach((w) => m.insertTag(w, `z:${s.size}`)));
    Object.entries(NUMBERS).forEach(([w, n]) => m.insertTag(w, `n:${n}`));
  });

// ---------------------------------------------------------------- reading words

export type WordRead = {
  word: string;
  path: string;
  kind: "actor" | "action" | "place" | "time" | "weather" | "color" | "size" | "number" | "thing" | "unknown";
  label: string;
  sym?: number;
  fuzzy?: boolean;
};

type Meaning =
  | { t: "kind"; kind: Kind; count: number }
  | { t: "action"; action: Action }
  | { t: "place"; place: Place }
  | { t: "time"; time: Time }
  | { t: "weather"; weather: Weather }
  | { t: "color"; color: string }
  | { t: "size"; size: number }
  | { t: "number"; n: number }
  | { t: "sym"; sym: number };

const ORDER = ["k", "n", "c", "z", "p", "t", "w", "a"];

function meaningOf(hit: Hit, token: string): Meaning | null {
  const tags = [...hit.tags];
  // an imperfect-verb spelling (يطير / تلعب) means the action even if the letters are also a noun
  const verbLike = /^[يت]/.test(normalize(token)) && tags.some((t) => t.startsWith("a:"));
  tags.sort((a, b) => (verbLike ? (b.startsWith("a:") ? 1 : 0) - (a.startsWith("a:") ? 1 : 0) : 0) || ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]));
  const tag = tags[0];
  if (tag) {
    const [c, v, extra] = tag.split(":");
    if (c === "k") return { t: "kind", kind: v as Kind, count: hit.plural ? 3 : Number(extra) || 1 };
    if (c === "a") return { t: "action", action: v as Action };
    if (c === "p") return { t: "place", place: v as Place };
    if (c === "t") return { t: "time", time: v as Time };
    if (c === "w") return { t: "weather", weather: v as Weather };
    if (c === "c") return { t: "color", color: v };
    if (c === "z") return { t: "size", size: Number(v) };
    if (c === "n") return { t: "number", n: Number(v) };
  }
  if (hit.syms.length) return { t: "sym", sym: hit.syms[0] };
  return null;
}

// particles and prepositions carry no symbol of their own
const STOP = new Set(
  "في من على الى عن مع تحت فوق قرب عند بجانب جانب امام خلف بين حول ثم بعد قبل هذا هذه ذلك تلك التي الذي هو هي هم كان كانت كل بعض جدا مثل او ام لا لم لن قد ان انه يوجد هناك the a an in on at of to with and near under".split(" "),
);

function tokens(text: string) {
  return text.split(/[^\p{L}\d]+/u).filter((w) => w && !STOP.has(normalize(w).replace(/^و/, "")));
}

function read(token: string): { hit: Hit | null; meaning: Meaning | null; num?: number } {
  if (/^\d+$/.test(token)) return { hit: null, meaning: { t: "number", n: Math.min(6, Number(token)) } };
  const hit = model().lookup(token);
  return { hit, meaning: hit ? meaningOf(hit, token) : null };
}

/** What the model understood from each word (for the live "letters → symbols" panel). */
export function readWords(text: string): WordRead[] {
  return tokens(text).map((w) => {
    const { hit, meaning } = read(w);
    const path = hit?.path || "";
    if (!meaning) return { word: w, path, kind: "unknown", label: "" };
    switch (meaning.t) {
      case "kind":
        return { word: w, path, kind: "actor", label: KIND_LABEL[meaning.kind], fuzzy: hit?.fuzzy };
      case "action":
        return { word: w, path, kind: "action", label: ACTION_LABEL[meaning.action], fuzzy: hit?.fuzzy };
      case "place":
        return { word: w, path, kind: "place", label: PLACE_LABEL[meaning.place], fuzzy: hit?.fuzzy };
      case "time":
        return { word: w, path, kind: "time", label: TIME_LABEL[meaning.time], fuzzy: hit?.fuzzy };
      case "weather":
        return { word: w, path, kind: "weather", label: WEATHER_LABEL[meaning.weather], fuzzy: hit?.fuzzy };
      case "color":
        return { word: w, path, kind: "color", label: "لون", fuzzy: hit?.fuzzy };
      case "size":
        return { word: w, path, kind: "size", label: meaning.size < 1 ? "صغير" : "كبير", fuzzy: hit?.fuzzy };
      case "number":
        return { word: w, path, kind: "number", label: String(meaning.n) };
      case "sym":
        return { word: w, path, kind: "thing", label: symbolInfo(meaning.sym).name, sym: meaning.sym, fuzzy: hit?.fuzzy };
    }
  });
}

// ---------------------------------------------------------------- scenes

const FLYERS: Kind[] = ["bird", "butterfly"];

function naturalAction(a: Actor, place: Place): Action {
  if (a.kind === "sym") {
    const role = symbolInfo(a.sym ?? 0).role;
    if (role === "m" || role === "w") return "swim";
    if (role === "f") return "fly";
    if (role === "v") return "run";
    return place === "house" ? "sit" : "walk";
  }
  if (a.kind === "fish") return "swim";
  if (FLYERS.includes(a.kind)) return "fly";
  if (a.kind === "car") return "run";
  if (a.kind === "ball") return "idle";
  return place === "house" ? "sit" : "walk";
}

const isMover = (sym: number) => ["a", "m", "v", "w", "f"].includes(symbolInfo(sym).role);

type Draft = {
  actors: Actor[];
  props: Prop[];
  target?: SceneCode["target"];
  place?: Place;
  time?: Time;
  weather?: Weather;
  lastAction: Action | null;
  caption: string;
};

function readChunk(text: string, inherits: boolean): Draft {
  const d: Draft = { actors: [], props: [], lastAction: null, caption: text.trim() };
  let pendingColor: string | undefined;
  let pendingSize = 1;
  let pendingCount = 0;
  const addActor = (a: Omit<Actor, "count" | "action" | "size" | "color"> & { count: number }) => {
    // a creature named right after a chase/play verb is what is chased / played with
    if ((d.actors.length || inherits) && (d.lastAction === "chase" || d.lastAction === "play") && !d.target) {
      d.target = { kind: a.kind, sym: a.sym };
    } else if (!d.actors.some((x) => x.kind === a.kind && x.sym === a.sym)) {
      d.actors.push({ ...a, count: pendingCount || a.count, action: d.lastAction || "idle", color: pendingColor, size: pendingSize });
    }
    pendingColor = undefined;
    pendingSize = 1;
    pendingCount = 0;
  };
  for (const tok of tokens(text)) {
    const { hit, meaning } = read(tok);
    if (!meaning) continue;
    const last = d.actors[d.actors.length - 1];
    switch (meaning.t) {
      case "number":
        pendingCount = meaning.n;
        break;
      case "kind":
        addActor({ kind: meaning.kind, count: meaning.count });
        break;
      case "color":
        if (last && !last.color) last.color = meaning.color;
        else pendingColor = meaning.color;
        break;
      case "size":
        if (last) last.size = meaning.size;
        else pendingSize = meaning.size;
        break;
      case "place":
        d.place ??= meaning.place;
        break;
      case "time":
        d.time ??= meaning.time;
        break;
      case "weather":
        d.weather ??= meaning.weather;
        break;
      case "action":
        d.lastAction = meaning.action;
        for (const a of d.actors) if (a.action === "idle") a.action = meaning.action;
        break;
      case "sym": {
        const info = symbolInfo(meaning.sym);
        if (info.role === "g") {
          if (info.place) d.place ??= info.place as Place;
        } else if (isMover(meaning.sym)) {
          addActor({ kind: "sym", sym: meaning.sym, count: hit?.plural ? 3 : 1 });
        } else if (d.props.length < 5 && !d.props.some((p) => p.sym === meaning.sym)) {
          d.props.push({ sym: meaning.sym });
        }
        break;
      }
    }
  }
  return d;
}

/**
 * Splits on sentence ends, «ثم / بعد ذلك / بعدها», commas, and on «و + verb»
 * when the current piece already has its own verb, so
 * "قطط تلعب في الحقل وتطارد الفراشة ثم تنام" becomes three scenes.
 */
function splitScenes(description: string): string[] {
  const coarse = description
    .split(/[.!؟?\n،,;]+|\s(?:ثم|بعد ذلك|بعدها|وبعدها|then|and then)\s/i)
    .map((s) => s.trim())
    .filter(Boolean);
  const isVerb = (w: string) => read(w).meaning?.t === "action";
  const out: string[] = [];
  for (const piece of coarse) {
    let cur: string[] = [];
    let curHasVerb = false;
    for (const w of piece.split(/\s+/)) {
      const n = normalize(w);
      if (n.startsWith("و") && n.length > 3 && curHasVerb && cur.length && isVerb(w.slice(1))) {
        out.push(cur.join(" "));
        cur = [w.slice(1)];
        continue;
      }
      if (isVerb(w)) curHasVerb = true;
      cur.push(w);
    }
    if (cur.length) out.push(cur.join(" "));
  }
  return out;
}

export const MAX_SCENES = 8;

/** The brain: description → scene codes. Missing facts carry over from the previous scene. */
export function understand(description: string): SceneCode[] {
  const scenes: SceneCode[] = [];
  let prev: SceneCode = { place: "field", time: "day", weather: "clear", actors: [], props: [], caption: "" };
  for (const chunk of splitScenes(description).slice(0, MAX_SCENES)) {
    const d = readChunk(chunk, prev.actors.length > 0);
    if (!d.actors.length && !d.lastAction && !d.place && !d.time && !d.weather && !d.props.length && !d.target) continue;
    let actors = d.actors;
    if (!actors.length) {
      // "وتطارد الفراشة" — same heroes as before, doing the new thing
      actors = prev.actors.length
        ? prev.actors.map((a, i) => ({ ...a, action: i === 0 && d.lastAction ? d.lastAction : a.action }))
        : [{ kind: "cat", count: 1, action: d.lastAction || "walk", size: 1 }];
    }
    const seaLife = actors.some((a) => a.kind === "sym" && ["m", "w"].includes(symbolInfo(a.sym ?? 0).role));
    const place = d.place ?? (seaLife && !prev.caption ? "sea" : prev.place);
    actors = actors.slice(0, 3).map((a) => ({ ...a, action: a.action === "idle" ? d.lastAction || naturalAction(a, place) : a.action }));
    const subjectAction = actors[0]?.action;
    const scene: SceneCode = {
      place,
      // space is always night; leaving it goes back to daylight unless the text says otherwise
      time: place === "space" ? "night" : d.time ?? (prev.place === "space" ? "day" : prev.time),
      weather: d.weather ?? (d.place && d.place !== prev.place ? "clear" : prev.weather),
      actors,
      target: subjectAction === "chase" || subjectAction === "play" ? d.target ?? (subjectAction === "play" ? { kind: "ball" } : undefined) : undefined,
      // things stay in the world until the place changes
      props: d.props.length ? d.props : d.place && d.place !== prev.place ? [] : prev.props,
      caption: d.caption.slice(0, 80),
    };
    scenes.push(scene);
    prev = scene;
  }
  if (!scenes.length) {
    scenes.push({ place: "field", time: "day", weather: "clear", actors: [{ kind: "cat", count: 1, action: "walk", size: 1 }], props: [], caption: description.trim().slice(0, 80) });
  }
  return scenes;
}

/** Every library symbol a story needs (to load its drawing before playing). */
export function symbolsOf(scenes: SceneCode[]): number[] {
  const set = new Set<number>();
  for (const s of scenes) {
    s.actors.forEach((a) => a.sym !== undefined && set.add(a.sym));
    s.props.forEach((p) => set.add(p.sym));
    if (s.target?.sym !== undefined) set.add(s.target.sym);
  }
  return [...set];
}

// ---------------------------------------------------------------- labels (UI)

export const KIND_LABEL: Record<Kind, string> = {
  cat: "قطة", dog: "كلب", rabbit: "أرنب", bird: "عصفور", butterfly: "فراشة", fish: "سمكة", person: "شخص", child: "طفل", car: "سيارة", ball: "كرة",
};
export const ACTION_LABEL: Record<Action, string> = {
  idle: "واقف", walk: "يمشي", run: "يركض", chase: "يطارد", play: "يلعب", jump: "يقفز", fly: "يطير", swim: "يسبح", sleep: "ينام", laugh: "يضحك", eat: "يأكل", dance: "يرقص", sit: "يجلس", look: "يتأمل",
};
export const PLACE_LABEL: Record<Place, string> = {
  field: "حقل", forest: "غابة", garden: "حديقة", sea: "بحر", river: "نهر", desert: "صحراء", city: "مدينة", house: "بيت", mountain: "جبل", space: "فضاء",
};
export const TIME_LABEL: Record<Time, string> = { morning: "صباح", day: "نهار", sunset: "غروب", night: "ليل" };
export const WEATHER_LABEL: Record<Weather, string> = { clear: "صافٍ", clouds: "غيوم", rain: "مطر", snow: "ثلج", wind: "رياح" };

export const ALL_KINDS = Object.keys(KIND_LABEL) as Kind[];
export const ALL_ACTIONS = Object.keys(ACTION_LABEL) as Action[];
export const ALL_PLACES = Object.keys(PLACE_LABEL) as Place[];
export const ALL_TIMES = Object.keys(TIME_LABEL) as Time[];
export const ALL_WEATHERS = Object.keys(WEATHER_LABEL) as Weather[];
