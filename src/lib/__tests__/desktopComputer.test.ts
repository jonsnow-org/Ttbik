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
        return new Response("event: generating\\ndata: []\\n\\n", { status: 200, headers: { "content-type": "text/event-stream" } });
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
