// «رموز» — our own text-to-motion engine, part 1: the symbol lexicon and the
// small rule-based "brain" that reads a description (Arabic or English) and
// turns it into a list of scene codes. No AI model and no outside service:
// every symbol here is ours, and the renderer (render.ts) draws each one from
// code, so the whole engine is a few tens of KB and runs in the visitor's
// browser.

export type Kind = "cat" | "dog" | "rabbit" | "bird" | "butterfly" | "fish" | "person" | "child" | "car" | "ball";
export type Action =
  | "idle"
  | "walk"
  | "run"
  | "chase"
  | "play"
  | "jump"
  | "fly"
  | "swim"
  | "sleep"
  | "laugh"
  | "eat"
  | "dance"
  | "sit"
  | "look";
export type Place = "field" | "forest" | "garden" | "sea" | "river" | "desert" | "city" | "house" | "mountain" | "space";
export type Time = "morning" | "day" | "sunset" | "night";
export type Weather = "clear" | "clouds" | "rain" | "snow" | "wind";

export type Actor = { kind: Kind; count: number; action: Action; color?: string; size: number };
export type SceneCode = {
  place: Place;
  time: Time;
  weather: Weather;
  actors: Actor[]; // actors[0] is the subject
  target?: Kind; // what the subject chases / plays with
  caption: string;
};

// ---------------------------------------------------------------- symbols

const KINDS: { kind: Kind; words: string[]; plural?: string[]; dual?: string[] }[] = [
  { kind: "cat", words: ["قط", "قطه", "قطت", "هر", "هره", "بسه", "بس", "قطيطه", "cat", "kitten", "kitty"], plural: ["قطط", "قطط", "هررة", "cats", "kittens"], dual: ["قطتان", "قطتين", "قطان", "قطين"] },
  { kind: "dog", words: ["كلب", "كلبه", "جرو", "puppy", "dog"], plural: ["كلاب", "جراء", "dogs", "puppies"], dual: ["كلبان", "كلبين"] },
  { kind: "rabbit", words: ["ارنب", "ارنبه", "rabbit", "bunny"], plural: ["ارانب", "rabbits"], dual: ["ارنبان", "ارنبين"] },
  { kind: "bird", words: ["طاير", "عصفور", "عصفوره", "حمامه", "طير", "bird", "sparrow", "dove"], plural: ["طيور", "عصافير", "حمام", "birds"], dual: ["عصفوران", "عصفورين"] },
  { kind: "butterfly", words: ["فراشه", "فراشت", "butterfly"], plural: ["فراشات", "فراش", "butterflies"], dual: ["فراشتان", "فراشتين"] },
  { kind: "fish", words: ["سمكه", "سمك", "fish"], plural: ["اسماك", "fishes"], dual: ["سمكتان", "سمكتين"] },
  { kind: "child", words: ["طفل", "طفله", "ولد", "بنت", "صبي", "فتاه", "kid", "child", "boy", "girl"], plural: ["اطفال", "اولاد", "بنات", "children", "kids"], dual: ["طفلان", "طفلين"] },
  { kind: "person", words: ["رجل", "امراه", "شاب", "شخص", "انسان", "رجلا", "man", "woman", "person"], plural: ["ناس", "رجال", "نساء", "اشخاص", "people"], dual: ["رجلان", "رجلين", "شخصان", "شخصين"] },
  { kind: "car", words: ["سياره", "سيارت", "عربه", "قطار", "حافله", "باص", "car", "bus", "train"], plural: ["سيارات", "cars"] },
  { kind: "ball", words: ["كره", "كرت", "ball"], plural: ["كرات", "balls"] },
];

// Verb stems: matched on the token and on the token with one leading
// imperfect prefix (ي/ت/ن/ا) removed, so يلعب/تلعب/يلعبون/لعب all hit "لعب".
const ACTIONS: { action: Action; stems: string[] }[] = [
  { action: "chase", stems: ["طارد", "مطارد", "لاحق", "ملاحق", "chase"] },
  { action: "play", stems: ["لعب", "العب", "play"] },
  { action: "run", stems: ["ركض", "جري", "جرى", "run", "race"] },
  { action: "walk", stems: ["مشي", "مشى", "مش", "تجول", "سير", "سار", "walk", "stroll"] },
  { action: "jump", stems: ["قفز", "نط", "jump", "hop"] },
  { action: "fly", stems: ["طير", "طار", "حلق", "fly", "flying"] },
  { action: "swim", stems: ["سبح", "سباح", "swim"] },
  { action: "sleep", stems: ["نام", "نوم", "نايم", "رتاح", "ستريح", "استراح", "استراحه", "راحه", "غفو", "sleep", "rest", "nap"] },
  { action: "laugh", stems: ["ضحك", "فرح", "سعيد", "مبتسم", "بتسم", "laugh", "happy", "smile"] },
  { action: "eat", stems: ["اكل", "كل", "طعام", "eat", "food"] },
  { action: "dance", stems: ["رقص", "dance"] },
  { action: "sit", stems: ["جلس", "جالس", "جلوس", "قعد", "sit"] },
  { action: "look", stems: ["نظر", "ينظر", "تامل", "شاهد", "راقب", "look", "watch", "gaze"] },
];

const PLACES: { place: Place; words: string[] }[] = [
  { place: "forest", words: ["غابه", "غابات", "اشجار", "forest", "woods", "jungle"] },
  { place: "garden", words: ["حديقه", "حدايق", "بستان", "منتزه", "ورود", "زهور", "garden", "park"] },
  { place: "sea", words: ["بحر", "البحر", "شاطي", "شط", "موج", "امواج", "محيط", "sea", "beach", "ocean"] },
  { place: "river", words: ["نهر", "بحيره", "بركه", "river", "lake", "pond"] },
  { place: "desert", words: ["صحرا", "صحراء", "رمال", "كثبان", "desert", "dunes"] },
  { place: "city", words: ["مدينه", "مدن", "شارع", "شوارع", "سوق", "اسواق", "حي", "city", "street", "town", "market"] },
  { place: "house", words: ["بيت", "منزل", "غرفه", "داخل", "house", "home", "room"] },
  { place: "mountain", words: ["جبل", "جبال", "قمه", "mountain", "mountains", "hill"] },
  { place: "space", words: ["فضاء", "الفضاء", "كواكب", "كوكب", "صاروخ", "space", "planet"] },
  { place: "field", words: ["حقل", "حقول", "مرج", "مروج", "عشب", "حشيش", "مزرعه", "ريف", "field", "meadow", "grass", "farm"] },
];

const TIMES: { time: Time; words: string[] }[] = [
  { time: "night", words: ["ليل", "ليلا", "ليله", "مساء", "قمر", "نجوم", "night", "moon", "stars"] },
  { time: "sunset", words: ["غروب", "شفق", "المغرب", "sunset", "dusk"] },
  { time: "morning", words: ["صباح", "صباحا", "فجر", "شروق", "morning", "dawn", "sunrise"] },
  { time: "day", words: ["نهار", "ظهر", "مشمس", "شمس", "day", "noon", "sunny"] },
];

const WEATHERS: { weather: Weather; words: string[] }[] = [
  { weather: "rain", words: ["مطر", "امطار", "ممطر", "rain", "rainy"] },
  { weather: "snow", words: ["ثلج", "ثلوج", "مثلج", "snow", "snowy"] },
  { weather: "wind", words: ["ريح", "رياح", "عاصفه", "هواء", "wind", "windy", "storm"] },
  { weather: "clouds", words: ["غيوم", "سحاب", "غيم", "clouds", "cloudy"] },
];

const COLORS: { color: string; words: string[] }[] = [
  { color: "#f8f6f0", words: ["ابيض", "بيضاء", "بيضا", "بيضاوان", "بيضاوين", "بيض", "white"] },
  { color: "#2b2b30", words: ["اسود", "سوداء", "سودا", "سوداوان", "سوداوين", "سود", "black"] },
  { color: "#f0913a", words: ["برتقالي", "برتقاليه", "orange"] },
  { color: "#9aa0a8", words: ["رمادي", "رماديه", "gray", "grey"] },
  { color: "#8a5a36", words: ["بني", "بنيه", "brown"] },
  { color: "#e8b93c", words: ["ذهبي", "ذهبيه", "اصفر", "صفراء", "golden", "yellow"] },
  { color: "#e0453a", words: ["احمر", "حمراء", "red"] },
  { color: "#3a7be0", words: ["ازرق", "زرقاء", "blue"] },
  { color: "#3fae5a", words: ["اخضر", "خضراء", "green"] },
  { color: "#f39ac4", words: ["وردي", "ورديه", "pink"] },
];

const SMALL = ["صغير", "صغيره", "صغار", "صغيرات", "little", "small", "baby", "tiny"];
const BIG = ["كبير", "كبيره", "ضخم", "big", "huge"];
const NUMBERS: Record<string, number> = { "اثنان": 2, "اثنين": 2, "ثلاث": 3, "ثلاثه": 3, "اربع": 4, "اربعه": 4, "خمس": 5, "خمسه": 5, two: 2, three: 3, four: 4, five: 5 };

// ---------------------------------------------------------------- reading

export function normalize(s: string) {
  return s
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي");
}

const PREFIXES = ["وبال", "فال", "وال", "بال", "كال", "لل", "ال", "و", "ف", "ب", "ل", "ك"];
const SUFFIXES = ["", "ي", "ها", "ه", "هم", "هن", "نا", "ك", "ان", "ين", "ون", "ات"];

/** All plausible bare forms of one word: with and without its clitics. */
function forms(token: string): string[] {
  const out = new Set([token]);
  for (const p of PREFIXES) if (token.startsWith(p) && token.length - p.length >= 2) out.add(token.slice(p.length));
  return [...out];
}

function hit(token: string, words: string[]) {
  for (const f of forms(token)) {
    for (const w of words) {
      if (f === w) return true;
      if (w.length >= 3 && f.startsWith(w) && SUFFIXES.includes(f.slice(w.length))) return true;
    }
  }
  return false;
}

function actionOf(token: string): Action | null {
  const bases = forms(token);
  for (const b of [...bases]) if (b.length >= 4 && /^[يتنا]/.test(b)) bases.push(b.slice(1));
  for (const { action, stems } of ACTIONS) {
    if (bases.some((b) => stems.some((s) => b === s || (s.length >= 2 && b.startsWith(s) && b.length - s.length <= 3)))) return action;
  }
  return null;
}

function kindOf(token: string): { kind: Kind; count: number } | null {
  for (const k of KINDS) {
    if (k.dual && hit(token, k.dual)) return { kind: k.kind, count: 2 };
    if (k.plural && hit(token, k.plural)) return { kind: k.kind, count: 3 };
    if (hit(token, k.words)) return { kind: k.kind, count: 1 };
  }
  return null;
}

const firstOf = <T,>(token: string, table: ({ words: string[] } & T)[]) => table.find((e) => hit(token, e.words));

const FLYERS: Kind[] = ["bird", "butterfly"];

/** Default action when the text names a creature but no verb. */
function naturalAction(kind: Kind, place: Place): Action {
  if (kind === "fish") return "swim";
  if (FLYERS.includes(kind)) return "fly";
  if (kind === "car") return "run";
  if (kind === "ball") return "idle";
  return place === "house" ? "sit" : "walk";
}

type Draft = Partial<Omit<SceneCode, "actors" | "caption">> & { actors: Actor[]; caption: string; hasAction: boolean };

function readChunk(text: string, inherits: boolean): Draft {
  const tokens = normalize(text).split(/[^\p{L}\d]+/u).filter(Boolean);
  const d: Draft = { actors: [], caption: text.trim(), hasAction: false };
  let pendingColor: string | undefined;
  let pendingSize = 1;
  let pendingCount = 0;
  let lastAction: Action | null = null;
  for (const tok of tokens) {
    const num = NUMBERS[tok] ?? (/^\d+$/.test(tok) ? Math.min(6, Number(tok)) : 0);
    if (num) {
      pendingCount = num;
      continue;
    }
    const k = kindOf(tok);
    if (k) {
      const subject = d.actors[0];
      // A creature named after a chase/play verb is the target, not a new actor
      // (also when the subject is carried over: "…وتطارد الفراشة").
      if ((subject || inherits) && (lastAction === "chase" || lastAction === "play") && !d.target) {
        d.target = k.kind;
      } else if (!d.actors.some((a) => a.kind === k.kind)) {
        d.actors.push({ kind: k.kind, count: pendingCount || k.count, action: lastAction || "idle", color: pendingColor, size: pendingSize });
      }
      pendingColor = undefined;
      pendingSize = 1;
      pendingCount = 0;
      continue;
    }
    const color = firstOf(tok, COLORS);
    if (color) {
      const a = d.actors[d.actors.length - 1];
      if (a && !a.color) a.color = color.color;
      else pendingColor = color.color;
      continue;
    }
    if (SMALL.some((w) => hit(tok, [w]))) {
      const a = d.actors[d.actors.length - 1];
      if (a) a.size = 0.8;
      else pendingSize = 0.8;
      continue;
    }
    if (BIG.some((w) => hit(tok, [w]))) {
      const a = d.actors[d.actors.length - 1];
      if (a) a.size = 1.25;
      else pendingSize = 1.25;
      continue;
    }
    const place = firstOf(tok, PLACES);
    if (place && !d.place) d.place = place.place;
    const time = firstOf(tok, TIMES);
    if (time && !d.time) d.time = time.time;
    const weather = firstOf(tok, WEATHERS);
    if (weather && !d.weather) d.weather = weather.weather;
    if (place || time || weather) continue;
    const act = actionOf(tok);
    if (act) {
      lastAction = act;
      d.hasAction = true;
      for (const a of d.actors) if (a.action === "idle") a.action = act;
    }
  }
  if (lastAction && d.actors.length === 0) d.actors = [];
  (d as Draft & { lastAction?: Action | null }).lastAction = lastAction;
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
  const out: string[] = [];
  for (const piece of coarse) {
    const words = piece.split(/\s+/);
    let cur: string[] = [];
    let curHasVerb = false;
    for (const w of words) {
      const n = normalize(w);
      const isVerbAfterWa = n.startsWith("و") && n.length > 3 && actionOf(n.slice(1)) !== null;
      if (isVerbAfterWa && curHasVerb && cur.length) {
        out.push(cur.join(" "));
        cur = [w.replace(/^و/, "")];
        curHasVerb = true;
        continue;
      }
      if (actionOf(n)) curHasVerb = true;
      cur.push(w);
    }
    if (cur.length) out.push(cur.join(" "));
  }
  return out;
}

export const MAX_SCENES = 8;

/** The brain: description → scene codes. Missing facts carry over from the previous scene. */
export function understand(description: string): SceneCode[] {
  const chunks = splitScenes(description).slice(0, MAX_SCENES);
  const scenes: SceneCode[] = [];
  let prev: SceneCode = { place: "field", time: "day", weather: "clear", actors: [], caption: "" };
  for (const chunk of chunks) {
    const d = readChunk(chunk, prev.actors.length > 0) as Draft & { lastAction?: Action | null };
    const nothing = !d.actors.length && !d.hasAction && !d.place && !d.time && !d.weather;
    if (nothing) continue;
    const place = d.place ?? prev.place;
    let actors = d.actors;
    if (!actors.length) {
      // "وتطارد الفراشة" — same heroes as before, doing the new thing.
      actors = prev.actors.length
        ? prev.actors.map((a, i) => ({ ...a, action: i === 0 && d.lastAction ? d.lastAction : a.action }))
        : [{ kind: "cat", count: 1, action: d.lastAction || "walk", size: 1 }];
    }
    actors = actors.map((a) => ({ ...a, action: a.action === "idle" ? d.lastAction || naturalAction(a.kind, place) : a.action }));
    const target = d.target ?? (d.lastAction === "play" && !d.target ? "ball" : undefined);
    const scene: SceneCode = {
      place,
      time: d.time ?? prev.time,
      weather: d.weather ?? (d.place && d.place !== prev.place ? "clear" : prev.weather),
      actors: actors.slice(0, 3),
      target: actors[0]?.action === "chase" || actors[0]?.action === "play" ? target : undefined,
      caption: d.caption.slice(0, 80),
    };
    if (scene.place === "space") scene.time = "night";
    scenes.push(scene);
    prev = scene;
  }
  if (!scenes.length) {
    scenes.push({ place: "field", time: "day", weather: "clear", actors: [{ kind: "cat", count: 1, action: "walk", size: 1 }], caption: description.trim().slice(0, 80) });
  }
  return scenes;
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
