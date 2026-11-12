import { cleanDesktopArgs, desktopLive } from "@/lib/desktopComputer";

describe("the graphical Linux desktop RPC contract", () => {
  test("opens the bounded live stream using the selected model's private session", async () => {
    const previousUrl = process.env.COMPUTER_STUDIO_URL;
    process.env.COMPUTER_STUDIO_URL = "https://computer.test";
    try {
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      const fetchMock = (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init });
        if (init?.method === "POST") return new Response(JSON.stringify({ event_id: "live-1" }), { status: 200 });
        return new Response("event: generating\ndata: []\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
      }) as typeof fetch;
      const response = await desktopLive("lfm25", "77:lfm25", 40, fetchMock);
      expect(response.ok).toBe(true);
      expect(calls).toHaveLength(2);
      expect(calls[0].url).toBe("https://computer.test/gradio_api/call/live");
      const encoded = JSON.parse(String(calls[0].init?.body)).data[0] as string;
      const args = JSON.parse(Buffer.from(encoded.slice(4), "base64").toString("utf8"));
      expect(args).toMatchObject({ session: "77:lfm25", seconds: 25, interval: 0.5 });
      expect(calls[1].url).toBe("https://computer.test/gradio_api/call/live/live-1");
    } finally {
      if (previousUrl === undefined) delete process.env.COMPUTER_STUDIO_URL;
      else process.env.COMPUTER_STUDIO_URL = previousUrl;
    }
  });

  test("retries a transient gateway 502 on the event stream using the same live event id", async () => {
    const previousUrl = process.env.COMPUTER_STUDIO_URL;
    process.env.COMPUTER_STUDIO_URL = "https://computer.test";
    try {
      const calls: Array<{ url: string; method: string }> = [];
      let reads = 0;
      const fetchMock = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = String(init?.method || "GET");
        calls.push({ url, method });
        if (method === "POST") return new Response(JSON.stringify({ event_id: "live-retry" }), { status: 200 });
        reads += 1;
        if (reads === 1) return new Response("upstream gateway", { status: 502 });
        return new Response("event: generating\ndata: []\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
      }) as typeof fetch;
      const response = await desktopLive("lfm25", "77:lfm25", 20, fetchMock);
      expect(response.ok).toBe(true);
      expect(calls.map((item) => item.method)).toEqual(["POST", "GET", "GET"]);
      expect(calls[1].url).toBe(calls[2].url);
      expect(calls[1].url).toContain("/gradio_api/call/live/live-retry");
    } finally {
      if (previousUrl === undefined) delete process.env.COMPUTER_STUDIO_URL;
      else process.env.COMPUTER_STUDIO_URL = previousUrl;
    }
  });

  test("retries a transient gateway 502 while opening the read-only live stream", async () => {
    const previousUrl = process.env.COMPUTER_STUDIO_URL;
    process.env.COMPUTER_STUDIO_URL = "https://computer.test";
    try {
      const calls: string[] = [];
      let submits = 0;
      const fetchMock = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const method = String(init?.method || "GET");
        calls.push(method);
        if (method === "POST" && ++submits === 1) return new Response("upstream gateway", { status: 502 });
        if (method === "POST") return new Response(JSON.stringify({ event_id: "live-after-retry" }), { status: 200 });
        return new Response("event: generating\ndata: []\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
      }) as typeof fetch;
      const response = await desktopLive("lfm25", "77:lfm25", 20, fetchMock);
      expect(response.ok).toBe(true);
      expect(calls).toEqual(["POST", "POST", "GET"]);
    } finally {
      if (previousUrl === undefined) delete process.env.COMPUTER_STUDIO_URL;
      else process.env.COMPUTER_STUDIO_URL = previousUrl;
    }
  });

  test("accepts only supported actions and validates keyboard events", () => {
    expect(cleanDesktopArgs({ action: "status" })).toEqual({ action: "status" });
    expect(cleanDesktopArgs({ action: "start" })).toEqual({ action: "start" });
    expect(cleanDesktopArgs({ action: "key", key: "alt+Tab" })).toEqual({ action: "key", key: "alt+Tab" });
    expect(cleanDesktopArgs({ action: "key", key: "Return;touch /tmp/x" })).toBeNull();
    expect(cleanDesktopArgs({ action: "rm -rf" })).toBeNull();
  });

  test("clamps mouse coordinates and validates buttons", () => {
    expect(cleanDesktopArgs({ action: "click", x: 99999, y: -12, button: "right" }))
      .toEqual({ action: "click", x: 1599, y: 0, button: "right" });
    expect(cleanDesktopArgs({ action: "move", x: 20.8, y: 40.2 }))
      .toEqual({ action: "move", x: 20, y: 40 });
    expect(cleanDesktopArgs({ action: "click", x: 1, y: 1, button: "shell" })).toBeNull();
    expect(cleanDesktopArgs({ action: "click", x: "not-a-number", y: 1 })).toBeNull();
  });

  test("bounds text, scrolling, browser launch and file/terminal launch", () => {
    const typed = cleanDesktopArgs({ action: "type", text: "x".repeat(5000) });
    expect(String(typed?.text).length).toBe(1200);
    expect(cleanDesktopArgs({ action: "scroll", direction: "up", amount: 99 }))
      .toEqual({ action: "scroll", direction: "up", amount: 8 });
    expect(cleanDesktopArgs({ action: "scroll", direction: "diagonal", amount: 2 })).toBeNull();
    expect(cleanDesktopArgs({ action: "launch", app: "browser", url: "https://example.com" }))
      .toEqual({ action: "launch", app: "browser", url: "https://example.com" });
    expect(cleanDesktopArgs({ action: "launch", app: "terminal" }))
      .toEqual({ action: "launch", app: "terminal" });
    expect(cleanDesktopArgs({ action: "launch", app: "notepad" as any })).toBeNull();
  });
});

describe("richer desktop input actions", () => {
  test("double click, drag, scroll at a point and the clipboard pass the bounded cleaner", () => {
    expect(cleanDesktopArgs({ action: "dblclick", x: 10, y: 20 })).toEqual({ action: "dblclick", x: 10, y: 20 });
    expect(cleanDesktopArgs({ action: "drag", x: 10, y: 20, x2: 300, y2: 400 })).toEqual({ action: "drag", x: 10, y: 20, x2: 300, y2: 400 });
    expect(cleanDesktopArgs({ action: "drag", x: 10, y: 20 })).toBeNull();
    expect(cleanDesktopArgs({ action: "scroll", direction: "left", amount: 2, x: 5, y: 6 })).toMatchObject({ direction: "left", amount: 2, x: 5, y: 6 });
    expect(cleanDesktopArgs({ action: "scroll", direction: "sideways" as any })).toBeNull();
    expect(cleanDesktopArgs({ action: "clipboard_set", text: "x".repeat(30000) })?.text).toHaveLength(20000);
    expect(cleanDesktopArgs({ action: "clipboard_get" })).toEqual({ action: "clipboard_get" });
    expect(cleanDesktopArgs({ action: "type", text: "x".repeat(2000) })?.text).toHaveLength(1200);
  });
});

describe("the shared hub's desktop is Nova's only", () => {
  test("Sham and Sham v2 reach THEIR OWN Studio (desktop_do / desktop_live), never the hub; Nova and LFM reach the hub", async () => {
    const saved = { hub: process.env.COMPUTER_STUDIO_URL, v1: process.env.SHAM_MODELSCOPE_URL, v2: process.env.SHAM_V2_URL };
    process.env.COMPUTER_STUDIO_URL = "https://hub.test";
    process.env.SHAM_MODELSCOPE_URL = "https://sham1.test";
    process.env.SHAM_V2_URL = "https://sham2.test";
    try {
      const { desktopTargetFor, desktopDo } = await import("@/lib/desktopComputer");
      expect(desktopTargetFor("sham")).toEqual({ base: "https://sham1.test", own: true });
      expect(desktopTargetFor("sham_v2")).toEqual({ base: "https://sham2.test", own: true });
      expect(desktopTargetFor("coder")).toEqual({ base: "https://hub.test", own: false });
      expect(desktopTargetFor("lfm25")).toEqual({ base: "https://hub.test", own: false });
      expect(desktopTargetFor("nope")).toBeNull();
      const urls: string[] = [];
      const fetchMock = (async (input: RequestInfo | URL, init?: RequestInit) => {
        urls.push(String(input));
        if (init?.method === "POST") return new Response(JSON.stringify({ event_id: "e1" }), { status: 200 });
        return new Response('event: complete\ndata: ["{\\"ok\\":true,\\"phase\\":\\"stopped\\"}"]\n\n', { status: 200, headers: { "content-type": "text/event-stream" } });
      }) as typeof fetch;
      await desktopDo("sham_v2", "1:sham_v2", { action: "status" }, fetchMock);
      expect(urls[0]).toBe("https://sham2.test/gradio_api/call/desktop_do");
      const live = await desktopLive("sham", "1:sham", 5, fetchMock);
      expect(live.ok).toBe(true);
      expect(urls.some((u) => u.includes("sham1.test/gradio_api/call/desktop_live"))).toBe(true);
      expect(urls.every((u) => !u.includes("hub.test"))).toBe(true);
    } finally {
      for (const [k, v] of [["COMPUTER_STUDIO_URL", saved.hub], ["SHAM_MODELSCOPE_URL", saved.v1], ["SHAM_V2_URL", saved.v2]] as const) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    }
  });
});
