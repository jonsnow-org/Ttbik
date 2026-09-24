// «رموز» letter-code model: every word is stored as a path of letters in one
// trie (shared beginnings are stored once), and a word ends on the symbols it
// means. Reading a word = walking its letters one by one: ق → ط → ه ⇒ 🐈.
// The symbol part is prebuilt (symbols.generated.ts); the engine's own words
// (motions, places, times, weather, colours…) are added on top at load.
import { SYMBOLS, TRIE } from "./symbols.generated";

type Node = { k: Map<string, Node>; syms?: number[]; tags?: string[] };

const newNode = (): Node => ({ k: new Map() });

/** Parses the compact trie string: {ids} ends a word, letter( … ) opens a branch. */
function parseTrie(src: string): Node {
  let i = 0;
  const readNode = (): Node => {
    const node = newNode();
    if (src[i] === "{") {
      const end = src.indexOf("}", i);
      node.syms = src
        .slice(i + 1, end)
        .split(",")
        .map((x) => parseInt(x, 36));
      i = end + 1;
    }
    while (i < src.length && src[i] !== ")") {
      const ch = src[i];
      i += 2; // letter + "("
      node.k.set(ch, readNode());
      i += 1; // ")"
    }
    return node;
  };
  return readNode();
}

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
const NOUN_SUFFIXES = ["", "ي", "ها", "ه", "هم", "هن", "نا", "ك", "ان", "ين", "ون", "ات", "ت", "تي", "تان", "تين"];
const VERB_SUFFIXES = ["", "ت", "وا", "ون", "ان", "ين", "ي", "نا", "تا", "تان", "ه", "ها", "هم"];

export type Hit = {
  word: string; // what the visitor typed
  path: string; // the letters actually walked in the model
  syms: number[]; // library symbols (indices into SYMBOLS)
  tags: string[]; // engine words: "k:cat", "a:run", "p:sea", "t:night", "w:rain", "c:#hex", "z:0.8", "n:3"
  plural: boolean;
  fuzzy: boolean;
};

class LetterModel {
  root: Node;
  letters: string[] = [];

  constructor() {
    this.root = parseTrie(TRIE);
  }

  insertTag(word: string, tag: string) {
    let node = this.root;
    for (const ch of normalize(word)) {
      let next = node.k.get(ch);
      if (!next) {
        next = newNode();
        node.k.set(ch, next);
      }
      node = next;
    }
    node.tags = [...(node.tags || []), tag];
  }

  /** Walks the letters; returns every word-end passed on the way with its depth. */
  private walk(form: string) {
    const ends: { depth: number; node: Node }[] = [];
    let node: Node | undefined = this.root;
    for (let d = 0; d < form.length && node; d++) {
      node = node.k.get(form[d]);
      if (node && (node.syms || node.tags)) ends.push({ depth: d + 1, node });
    }
    return ends;
  }

  private fuzzy(form: string): Node | null {
    // one wrong / missing / extra letter, only for words long enough to be unambiguous
    if (form.length < 5) return null;
    const found: Node[] = [];
    const go = (node: Node, i: number, edits: number) => {
      if (found.length) return;
      if (i === form.length && (node.syms || node.tags)) {
        found.push(node);
        return;
      }
      const next = i < form.length ? node.k.get(form[i]) : undefined;
      if (next) go(next, i + 1, edits);
      if (edits === 0) {
        if (i < form.length) go(node, i + 1, 1); // extra letter typed
        node.k.forEach((child, ch) => {
          if (ch !== form[i]) {
            go(child, i + 1, 1); // wrong letter
            go(child, i, 1); // missing letter
          }
        });
      }
    };
    go(this.root, 0, 0);
    return found[0] || null;
  }

  lookup(token: string): Hit | null {
    const norm = normalize(token);
    const forms = [norm];
    for (const p of PREFIXES) if (norm.startsWith(p) && norm.length - p.length >= 2) forms.push(norm.slice(p.length));
    // Rank every reading: engine words (motions, places…) beat library symbols,
    // then a whole-word match beats a prefix, then the longer walk wins.
    let best: { node: Node; path: string; exact: boolean; rest: string; score: number } | null = null;
    for (const f of forms) {
      for (const verb of [false, true]) {
        // verbs: also drop one imperfect prefix (يلعب → لعب) and allow conjugation endings
        const base = verb ? (f.length >= 4 && /^[يتنا]/.test(f) ? f.slice(1) : null) : f;
        if (!base) continue;
        for (const { depth, node } of this.walk(base).reverse()) {
          const rest = base.slice(depth);
          const nounOk = NOUN_SUFFIXES.includes(rest);
          const verbOk = VERB_SUFFIXES.includes(rest) && node.tags?.some((t) => t.startsWith("a:"));
          if (!nounOk && !verbOk) continue;
          const exact = rest === "";
          const score = (node.tags ? 100 : 0) + (exact ? 10 : 0) + depth;
          if (!best || score > best.score) best = { node, path: base.slice(0, depth), exact, rest, score };
          break;
        }
      }
    }
    if (best) {
      return {
        word: token,
        path: best.path,
        syms: best.node.syms || [],
        tags: best.node.tags || [],
        plural: ["ات", "ون", "ين"].includes(best.rest),
        fuzzy: false,
      };
    }
    const f = this.fuzzy(forms[forms.length - 1]) || this.fuzzy(norm);
    if (f) return { word: token, path: norm, syms: f.syms || [], tags: f.tags || [], plural: false, fuzzy: true };
    return null;
  }
}

let model: LetterModel | null = null;
export function letterModel(setup: (m: LetterModel) => void) {
  if (!model) {
    model = new LetterModel();
    setup(model);
  }
  return model;
}

export type SymbolInfo = { file: string; role: "a" | "m" | "v" | "w" | "f" | "b" | "p" | "s" | "g"; place: string; name: string; en: string };
export function symbolInfo(i: number): SymbolInfo {
  const [file, role, place, name, en] = SYMBOLS[i] || ["", "p", "", "", ""];
  return { file, role: role as SymbolInfo["role"], place, name, en };
}
export const SYMBOL_COUNT = SYMBOLS.length;

/** A letter's code in the model: its position in the Arabic alphabet (for display). */
const ALPHABET = "ابتثجحخدذرزسشصضطظعغفقكلمنهوي";
export function letterCode(ch: string) {
  const i = ALPHABET.indexOf(ch);
  return i >= 0 ? i + 1 : 0;
}
