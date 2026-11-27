// Mounts the Nova Mini App's Skills screen and checks what it renders — the screen itself, not a copy of it. The screen's own
// server call (/api/coder/app, op "schedules") is answered from a fixture, and a fake Telegram launch is installed first so the
// request carries the same x-telegram-init-data header the real app sends. Nothing in the screen is changed for the test.
import { JSDOM } from "jsdom";
import React from "react";
import { NSTR } from "@/app/coder-app/_nova/strings";
import { STR } from "@/app/coder-app/i18n";
import { bindingFor } from "@/lib/miniAppBinding";
import { SKILL_CATS, SKILL_PRESETS } from "@/lib/skillPresets";

// A syntactically complete Telegram init data string (the hash here is a placeholder: this test drives the client, it does not
// ask the server to verify a signature).
const INIT_DATA = [
  "query_id=AAHfakeQuery",
  `user=${encodeURIComponent(JSON.stringify({ id: 4242, first_name: "Test", language_code: "ar" }))}`,
  "auth_date=1795000000",
  `hash=${"0".repeat(64)}`,
].join("&");

// The Telegram bridge is the one seam stubbed here: tma-js-bridge validates window.location against Telegram's own launch schema
// and refuses a synthetic localhost URL, so the test hands the screen the same launch initData a real Telegram launch would give it.
// Everything after that — api(), the request, its x-telegram-init-data header — is the app's real code.
const mockBridge = { initData: "" };
jest.mock("@/app/coder-app/_tma/sdk", () => {
  const actual = jest.requireActual("@/app/coder-app/_tma/sdk");
  return { ...actual, rawInitData: () => mockBridge.initData };
});

const ENABLED = SKILL_PRESETS[0];      // the skill this model already has a schedule for
const AVAILABLE = SKILL_PRESETS[1];    // a skill still waiting in Explore

const SCHEDULE = {
  id: "sch_1",
  title: `${ENABLED.icon} ${ENABLED.title.ar}`,
  prompt: ENABLED.prompt,
  kind: "cron",
  cron: "0 8 * * *",
  tz: "Asia/Damascus",
  repo: null,
  events: [],
  paused: false,
  next_run_at: "2026-11-28T06:00:00.000Z",
  last_run_at: null,
  last_status: null,
  hook_id: null,
  describe: "كل يوم 8:00",
};

const ME = {
  tier: "user",
  settings: { model: "coder", think: false, lang: "ar", tz: "Asia/Damascus", repo: "" },
  connections: { github: { linked: false } },
  oauth: false,
  prefs: { rules: [], categories: [] },
  events: [],
};

type Call = { op: string; initData: string | null };

describe("Nova Mini App — Skills screen", () => {
  const calls: Call[] = [];
  let dom: JSDOM;
  let container: HTMLElement;
  let text: string;
  let root: { unmount: () => void } | null = null;
  let realFetch: typeof fetch;

  beforeAll(async () => {
    mockBridge.initData = INIT_DATA;
    dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "https://mini.local/coder-app" });
    const w = dom.window as any;
    w.matchMedia = w.matchMedia || ((media: string) => ({ matches: false, media, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }));
    (globalThis as any).window = w;
    (globalThis as any).document = w.document;
    Object.defineProperty(globalThis, "navigator", { value: w.navigator, configurable: true });
    for (const key of [
      "HTMLElement", "HTMLIFrameElement", "Element", "Node", "DocumentFragment", "Event", "CustomEvent", "MouseEvent", "KeyboardEvent",
      // sessionStorage matters: the Telegram SDK keeps the parsed launch params there, and without it the launch read throws.
      "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "MutationObserver", "localStorage", "sessionStorage", "matchMedia", "Image",
    ]) {
      if (!(key in globalThis)) (globalThis as any)[key] = w[key];
    }
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = false;

    realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init: any) => {
      const body = JSON.parse(String(init?.body || "{}"));
      calls.push({ op: String(body.op || ""), initData: init?.headers?.["x-telegram-init-data"] ?? null });
      return { ok: true, status: 200, json: async () => ({ schedules: [SCHEDULE] }) };
    }) as unknown as typeof fetch;

    const { createRoot } = await import("react-dom/client");
    // The app always mounts its screens inside telegram-ui's AppRoot (NovaApp's own rule: without it the first Spinner throws).
    const { AppRoot } = await import("@telegram-apps/telegram-ui");
    const { Skills } = await import("@/app/coder-app/_nova/NovaApp");
    const ctx = {
      t: STR.ar, n: NSTR.ar, lang: "ar", me: ME, owner: false, go: () => {}, open: () => {}, reload: () => {},
      mode: { dark: true } as any, bind: bindingFor("coder"),
    };

    container = w.document.getElementById("root") as HTMLElement;
    root = createRoot(container) as unknown as { unmount: () => void };
    (root as any).render(React.createElement(AppRoot as any, null, React.createElement(Skills as any, { c: ctx })));
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 10));
    text = container.textContent || "";
  });

  afterAll(() => {
    try { root?.unmount(); } catch { /* the DOM goes away with the test */ }
    globalThis.fetch = realFetch;
    (globalThis as any).window = undefined;
    (globalThis as any).document = undefined;
    dom?.window?.close();
  });

  it("asks its own model for the schedules, with the launch's initData attached", () => {
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].op).toBe("schedules");
    expect(calls[0].initData).toBe(INIT_DATA);
  });

  it("renders the search box and Create skill", () => {
    const search = container.querySelector('input[type="search"]') as HTMLInputElement | null;
    expect(search).toBeTruthy();
    expect(search?.getAttribute("placeholder")).toBe(`🔎 ${NSTR.ar.skillsSearch}`);
    expect(text).toContain(NSTR.ar.skillsCreate);
    expect(text).toContain(NSTR.ar.skillsAll);
    for (const cat of SKILL_CATS) expect(text).toContain(cat.label.ar);
  });

  it("shows the enabled skill under My skills with its schedule", () => {
    expect(text).toContain(NSTR.ar.skillsMine);
    expect(text).toContain(NSTR.ar.skillsMineCap);
    expect(text).toContain(ENABLED.title.ar);
    expect(text).toContain(SCHEDULE.describe);
    expect(text).toContain("✓");
    expect(text).not.toContain(NSTR.ar.skillsNone);
  });

  it("shows the skill the user has not added yet under Explore, with its add button", () => {
    expect(text).toContain(NSTR.ar.skillsExplore);
    expect(text).toContain(AVAILABLE.title.ar);
    expect(text).toContain(AVAILABLE.desc.ar);
    const add = container.querySelector(`button[aria-label="${NSTR.ar.skillsAdd}: ${AVAILABLE.title.ar}"]`);
    expect(add).toBeTruthy();
    expect(add?.textContent).toBe("+");
  });

  it("does not show an already enabled skill again in Explore", () => {
    const adds = Array.from(container.querySelectorAll("button.n-plus")).map((b) => b.getAttribute("aria-label"));
    expect(adds).not.toContain(`${NSTR.ar.skillsAdd}: ${ENABLED.title.ar}`);
    expect(adds).toContain(`${NSTR.ar.skillsAdd}: ${AVAILABLE.title.ar}`);
  });
});
