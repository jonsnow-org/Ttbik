import { browserDo, browserStudioFor, cleanBrowserArgs, renderBrowserReply } from "@/lib/browserComputer";

describe("the model's own browser", () => {
  test("each model uses only its own Studio; models without one have no browser", () => {
    const bases = ["qwen35-9b", "gemma4-e4b", "minicpmo45"].map((m) => browserStudioFor(m));
    expect(new Set(bases).size).toBe(3);
    expect(bases[0]).toContain("sham-donor-qwen35-9b-media");
    expect(browserStudioFor("sham_v2")).toContain("sham-v2-video-server");
    for (const other of ["sham", "", undefined, "../x"]) expect(browserStudioFor(other as string | undefined)).toBeNull();
  });

  test("only known actions and bounded fields reach the Studio", () => {
    expect(cleanBrowserArgs({ action: "open", url: "example.com" })).toEqual({ action: "open", url: "example.com" });
    expect(cleanBrowserArgs({ action: "rm -rf" })).toBeNull();
    const typed = cleanBrowserArgs({ action: "type", id: "3", text: "x".repeat(5000), enter: true, dy: 99999 });
    expect(typed).toMatchObject({ action: "type", id: 3, enter: true, dy: 4000 });
    expect(String(typed!.text).length).toBe(2000);
    expect(cleanBrowserArgs({ action: "click", x: 10, y: 20 })).toEqual({ action: "click", x: 10, y: 20 });
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
    const out = await browserDo("gemma4-e4b", "42:gemma4-e4b", { action: "open", url: "a.test" }, fetchImpl);
    expect(out).toContain("PAGE TEXT:\nHi");
    expect(calls[0].url).toContain("sham-donor-gemma4-e4b-media");
    expect(JSON.parse(calls[0].body.data[0])).toEqual({ action: "open", url: "a.test", session: "42:gemma4-e4b" });
    expect(await browserDo("sham", "1:x", { action: "look" }, fetchImpl)).toMatch(/no browser Studio/);
  });
});
