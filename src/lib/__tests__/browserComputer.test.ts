import { browserDo, browserStudioFor, cleanBrowserArgs, renderBrowserReply } from "@/lib/browserComputer";

describe("the model's own browser", () => {
  test("each model uses only its own Studio; models without one have no browser", () => {
    const bases = ["qwen35-9b", "gemma4-e4b", "minicpmo45"].map((m) => browserStudioFor(m));
    expect(new Set(bases).size).toBe(3);
    expect(bases[0]).toContain("sham-donor-qwen35-9b-media");
    for (const other of ["sham", "sham_v2", "", undefined, "../x"]) expect(browserStudioFor(other as string | undefined)).toBeNull();
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
    expect(await browserDo("sham_v2", "1:x", { action: "look" }, fetchImpl)).toMatch(/no browser Studio/);
  });
});
