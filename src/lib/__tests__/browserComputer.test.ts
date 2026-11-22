import { DEFAULT_NOVA2_COMPUTER_STUDIO_URL, browserDo, browserStudioFor, cleanBrowserArgs, renderBrowserReply, studioToken } from "@/lib/browserComputer";
import { COMPUTER_MODEL_OPTIONS } from "@/lib/computerModels";

describe("the model's own browser", () => {
  test("one Nova: its own hub default is the international hub; the international hub takes the international token; COMPUTER_STUDIO_URL / off override", () => {
    const prior = { hub: process.env.COMPUTER_STUDIO_URL, own: process.env.NOVA2_COMPUTER_STUDIO_URL, tok: process.env.NOVA2_STUDIO_TOKEN };
    try {
      delete process.env.COMPUTER_STUDIO_URL; delete process.env.NOVA2_COMPUTER_STUDIO_URL;
      expect(browserStudioFor("coder")).toBe(DEFAULT_NOVA2_COMPUTER_STUDIO_URL);
      process.env.NOVA2_STUDIO_TOKEN = "ai-token";
      expect(studioToken(DEFAULT_NOVA2_COMPUTER_STUDIO_URL)).toBe("ai-token");
      process.env.COMPUTER_STUDIO_URL = "https://computer-hub.example.test";
      expect(browserStudioFor("coder")).toBe("https://computer-hub.example.test");
      process.env.COMPUTER_STUDIO_URL = "off";
      expect(browserStudioFor("coder")).toBeNull();
      process.env.NOVA2_COMPUTER_STUDIO_URL = "off";
      expect(browserStudioFor("nova2")).toBeNull();
      for (const other of ["", undefined, "../x", "nova"]) expect(browserStudioFor(other as string | undefined)).toBeNull();
    } finally {
      if (prior.hub === undefined) delete process.env.COMPUTER_STUDIO_URL; else process.env.COMPUTER_STUDIO_URL = prior.hub;
      if (prior.own === undefined) delete process.env.NOVA2_COMPUTER_STUDIO_URL; else process.env.NOVA2_COMPUTER_STUDIO_URL = prior.own;
      if (prior.tok === undefined) delete process.env.NOVA2_STUDIO_TOKEN; else process.env.NOVA2_STUDIO_TOKEN = prior.tok;
    }
  });
  test("only known actions and bounded fields reach the Studio", () => {
    expect(cleanBrowserArgs({ action: "open", url: "example.com" })).toEqual({ action: "open", url: "example.com" });
    expect(cleanBrowserArgs({ action: "rm -rf" })).toBeNull();
    const typed = cleanBrowserArgs({ action: "type", id: "3", text: "x".repeat(5000), enter: true, dy: 99999 });
    expect(typed).toMatchObject({ action: "type", id: 3, enter: true, dy: 4000 });
    expect(String(typed!.text).length).toBe(2000);
    expect(cleanBrowserArgs({ action: "click", x: 10, y: 20 })).toEqual({ action: "click", x: 10, y: 20 });
  });

  test("exposes real tabs, file transfer, form controls and browser diagnostics", () => {
    expect(cleanBrowserArgs({ action: "tabs" })).toEqual({ action: "tabs" });
    expect(cleanBrowserArgs({ action: "new_tab" })).toEqual({ action: "new_tab" });
    expect(cleanBrowserArgs({ action: "switch_tab", index: 99 })).toEqual({ action: "switch_tab", index: 11 });
    expect(cleanBrowserArgs({ action: "upload", id: 3, file_path: "Documents/arabic.pdf" })).toEqual({ action: "upload", id: 3, file_path: "Documents/arabic.pdf" });
    expect(cleanBrowserArgs({ action: "download", selector: "a.export", output_path: "Downloads/report.pdf" }))
      .toEqual({ action: "download", selector: "a.export", output_path: "Downloads/report.pdf" });
    expect(cleanBrowserArgs({ action: "select", id: 4, value: "ar" })).toEqual({ action: "select", id: 4, value: "ar" });
    expect(cleanBrowserArgs({ action: "check", selector: "input[type=checkbox]" })).toEqual({ action: "check", selector: "input[type=checkbox]" });
    expect(cleanBrowserArgs({ action: "console" })).toEqual({ action: "console" });
    expect(cleanBrowserArgs({ action: "network" })).toEqual({ action: "network" });
    expect(cleanBrowserArgs({ action: "upload", file_path: "../secrets.txt" })).toEqual({ action: "upload", file_path: "../secrets.txt" }); // path is revalidated inside the session by the Studio
    expect(cleanBrowserArgs({ action: "network", selector: "x".repeat(1000) })!.selector as string).toHaveLength(300);
    const reply = renderBrowserReply({ ok: true, url: "https://a.test/", title: "A", text: "ok", elements: "", tabs: [{ index: 0, active: true, url: "https://a.test/" }], console_errors: ["pageerror: script failed"], network_errors: ["500 https://a.test/api"], download: { path: "Downloads/a.pdf", bytes: 12 } });
    expect(reply).toContain("OPEN TABS");
    expect(reply).toContain("PAGE CONSOLE ERRORS");
    expect(reply).toContain("FAILED / HTTP ERROR REQUESTS");
    expect(reply).toContain("DOWNLOADED FILE");
  });

  test("the model reads the page text and the numbered elements", () => {
    const text = renderBrowserReply({ ok: true, url: "https://a.test/", title: "A", text: "Hello", elements: '[1] link "Home"' });
    expect(text).toContain("PAGE TEXT:\nHello");
    expect(text).toContain('[1] link "Home"');
    expect(renderBrowserReply({ ok: false, error: "nope" })).toBe("error: nope");
  });

  test("waiting, the outline, drawn areas and a restored session are part of the contract", () => {
    expect(cleanBrowserArgs({ action: "wait", text: "Welcome", seconds: 999 })).toEqual({ action: "wait", text: "Welcome", seconds: 20 });
    expect(cleanBrowserArgs({ action: "aria" })).toEqual({ action: "aria" });
    const text = renderBrowserReply({ ok: true, url: "https://a.test/", title: "A", text: "Hi", elements: "", visual: "canvas at x=1 y=2 size 300x200", outline: "- heading \"Hi\"", resumed: true });
    expect(text).toContain("earlier session was restored");
    expect(text).toContain("DRAWN AREAS WITHOUT READABLE TEXT");
    expect(text).toContain("canvas at x=1 y=2");
    expect(text).toContain("PAGE OUTLINE");
  });

  test("a call goes to the model's own Studio with its own session id", async () => {
    process.env.MODELSCOPE_API_TOKEN = "t";
    const calls: { url: string; body?: any }[] = [];
    const fetchImpl = jest.fn(async (input: any, init?: any) => {
      const url = String(input);
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith("/gradio_api/call/browser_do")) return new Response(JSON.stringify({ event_id: "e1" }), { status: 200 });
      return new Response("event: complete\ndata: " + JSON.stringify([JSON.stringify({ ok: true, url: "https://a.test/", title: "A", text: "Hi", elements: "" })]) + "\n\n", { status: 200 });
    }) as any;
    const out = await browserDo("coder", "42:coder", { action: "open", url: "a.test" }, fetchImpl);
    expect(out).toContain("PAGE TEXT:\nHi");
    expect(calls[0].url).toContain("sham-trainer-2");
    expect(calls[0].body.data[0]).toMatch(/^b64:/);
    expect(JSON.parse(Buffer.from(calls[0].body.data[0].slice(4), "base64").toString("utf8"))).toEqual({ action: "open", url: "a.test", session: "42:coder" });
    // Sham and Sham v2 have no browser Studio: their browser runs inside the model's own loop (owner 2026-11-08), so nothing is sent
    const before = calls.length;
    expect(await browserDo("sham", "1:sham", { action: "look" }, fetchImpl)).toMatch(/no browser Studio/);
    expect(await browserDo("sham_v2", "1:v2", { action: "look" }, fetchImpl)).toMatch(/no browser Studio/);
    expect(calls.length).toBe(before);
  });
});
