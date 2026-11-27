// The owner opened the Mini App on the default model and found neither Skills nor "Scheduled tasks": both were gated on a
// narrow condition (the model owning its own scheduler), so they vanished outside Nova. This mounts the REAL Home and
// Schedules screens for a model without a scheduler and for Nova, and asserts the doors are there and open the screen.
import { JSDOM } from "jsdom";
import React from "react";
import { NSTR } from "@/app/coder-app/_nova/strings";
import { STR } from "@/app/coder-app/i18n";
import { bindingFor } from "@/lib/miniAppBinding";

const mockBridge = { initData: "" };
jest.mock("@/app/coder-app/_tma/sdk", () => {
  const actual = jest.requireActual("@/app/coder-app/_tma/sdk");
  return { ...actual, rawInitData: () => mockBridge.initData };
});

const ME = {
  tier: "user",
  settings: { model: "sham", think: false, lang: "ar", tz: "Asia/Damascus", repo: "" },
  connections: { github: { linked: false } },
  oauth: false,
  prefs: { rules: [], categories: [] },
  events: [],
};

const MODELS = { models: [{ id: "coder", name: { ar: "نوفا", en: "Nova" }, desc: { ar: "", en: "" }, price_stars: null, selected: true }] };

type Call = { op: string };
const calls: Call[] = [];

function ctxFor(model: string, opened: unknown[]) {
  return {
    t: STR.ar, n: NSTR.ar, lang: "ar", me: ME, owner: false,
    go: () => {}, open: (p: unknown) => opened.push(p), reload: () => {},
    mode: { dark: true } as any, bind: bindingFor(model),
  };
}

const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 10)); };

describe("Nova Mini App — Skills and Schedules are on every model", () => {
  let dom: JSDOM;
  let realFetch: typeof fetch;
  let mounted: { unmount: () => void }[] = [];

  beforeAll(async () => {
    dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://mini.local/coder-app" });
    const w = dom.window as any;
    for (const key of [
      "HTMLElement", "HTMLIFrameElement", "Element", "Node", "DocumentFragment", "Event", "CustomEvent", "MouseEvent", "KeyboardEvent",
      "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "MutationObserver", "localStorage", "sessionStorage", "matchMedia", "Image",
    ]) if (!(key in globalThis)) (globalThis as any)[key] = w[key];
    (globalThis as any).window = w;
    (globalThis as any).document = w.document;
    Object.defineProperty(globalThis, "navigator", { value: w.navigator, configurable: true });
    Object.defineProperty(w.document, "visibilityState", { get: () => "visible", configurable: true });

    realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init: any) => {
      const op = String(JSON.parse(String(init?.body || "{}")).op || "");
      calls.push({ op });
      const body =
        op === "billing" ? { plans: [], usage: null }
        : op === "connectors" ? { connectors: [] }
        : op === "threads" ? { threads: [], current: null, currentEmpty: true, live: [], runs: [], pending: [] }
        : op === "schedules" ? { schedules: [] }
        : {};
      return { ok: true, status: 200, json: async () => body };
    }) as unknown as typeof fetch;
  });

  afterAll(() => {
    for (const r of mounted) { try { r.unmount(); } catch { /* DOM is torn down with the test */ } }
    globalThis.fetch = realFetch;
    (globalThis as any).window = undefined;
    (globalThis as any).document = undefined;
    dom?.window?.close();
  });

  async function mount(node: (m: typeof import("@/app/coder-app/_nova/NovaApp")) => React.ReactElement) {
    const { createRoot } = await import("react-dom/client");
    const { AppRoot } = await import("@telegram-apps/telegram-ui");
    const mod = await import("@/app/coder-app/_nova/NovaApp");
    const container = (globalThis as any).document.createElement("div");
    (globalThis as any).document.body.appendChild(container);
    const root = createRoot(container);
    root.render(React.createElement(AppRoot as any, null, node(mod)));
    mounted.push(root);
    await settle();
    return container as HTMLElement;
  }

  it("keeps the Scheduled tasks tab in the bottom nav for a model without its own scheduler", async () => {
    const { navTabs } = await import("@/app/coder-app/_nova/NovaApp");
    expect(navTabs(undefined)).toContain("auto");
    expect(navTabs(ME.features as any)).toContain("auto");
    expect(navTabs(undefined)).not.toContain("computer");
    expect(navTabs({ computer: true } as any)).toContain("computer");
  });

  for (const model of ["sham", "coder"]) {
    it(`shows the Skills door on Home for ${model} and opens the Skills screen`, async () => {
      const opened: unknown[] = [];
      const container = await mount((mod) =>
        React.createElement(mod.Home as any, {
          c: ctxFor(model, opened), firstName: "", models: MODELS, modelsError: "", modelsLoading: false, reloadModels: async () => true,
        }));

      const skillsRow = Array.from(container.querySelectorAll("button.n-row"))
        .find((b) => (b.textContent || "").includes(NSTR.ar.h_skill));
      expect(skillsRow).toBeTruthy();
      expect(skillsRow!.textContent).toContain(NSTR.ar.h_skillSub);

      skillsRow!.dispatchEvent(new (globalThis as any).MouseEvent("click", { bubbles: true }));
      await settle();
      expect(opened).toContainEqual({ k: "skills" });
    });
  }

  it("opens Scheduled tasks on a model without a scheduler and explains itself instead of an empty list", async () => {
    calls.length = 0;
    const opened: unknown[] = [];
    const container = await mount((mod) =>
      React.createElement(mod.Schedules as any, { c: ctxFor("sham", opened) }));

    const text = container.textContent || "";
    expect(text).toContain(NSTR.ar.schedTitle);
    expect(text).toContain(NSTR.ar.schedOff);
    expect(text).toContain(NSTR.ar.skillsTitle);            // the Skills card stays on the Schedules screen too
    expect(text).not.toContain(STR.ar.noSchedules);          // not the "you have no tasks yet" empty state
    expect(container.querySelector("button.n-fab")).toBeNull();
    expect(calls.map((c) => c.op)).not.toContain("schedules"); // never ask a model that has no scheduler
  });
});
