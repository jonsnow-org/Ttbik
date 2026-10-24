import { coderChat, coderJobResult } from "@/lib/openCoderStudio";
import { providerConfig } from "@/lib/coderProvider";

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
  delete process.env.NOVA_PRO_MODEL;
  delete process.env.NOVA_PRO_API_KEY;
  delete process.env.NOVA_PRO_API_URL;
});

describe("Nova Pro provider (chosen by hand, no fallback)", () => {
  it("is not configured without a model name and a key", () => {
    delete process.env.MODELSCOPE_API_TOKEN;
    expect(providerConfig("nova_pro")).toBeNull();
    process.env.NOVA_PRO_MODEL = "Qwen/Qwen3.5-397B-A17B";
    expect(providerConfig("nova_pro")).toBeNull();
    process.env.NOVA_PRO_API_KEY = "k";
    expect(providerConfig("nova_pro")).toMatchObject({ model: "Qwen/Qwen3.5-397B-A17B", base: "https://api-inference.modelscope.cn/v1" });
    expect(providerConfig("coder")).toBeNull();
  });

  it("answers in the Studio's finished-job shape, tool calls included, and sends the key only to the API", async () => {
    process.env.NOVA_PRO_MODEL = "m/x";
    process.env.NOVA_PRO_API_KEY = "secret-key";
    const seen: any[] = [];
    global.fetch = (async (url: string, init: any) => {
      seen.push({ url, auth: init.headers.Authorization, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ choices: [{ finish_reason: "tool_calls", message: { content: "", tool_calls: [{ id: "c1", function: { name: "ask_user", arguments: { q: 1 } } }] } }] }), { status: 200 });
    }) as any;
    const o = await coderChat([{ role: "user", content: "hi" }], { model: "nova_pro", tools: [{ type: "function", function: { name: "ask_user", description: "", parameters: {} } }] });
    expect(seen[0].url).toBe("https://api-inference.modelscope.cn/v1/chat/completions");
    expect(seen[0].body).toMatchObject({ model: "m/x", stream: false });
    expect(o.reply?.type).toBe("done");
    expect(o.reply?.tool_calls?.[0].function).toEqual({ name: "ask_user", arguments: '{"q":1}' });
    expect((await coderJobResult(o.reply!.job!)).reply?.type).toBe("gone");
  });

  it("an API error is a visible failure, never an answer from another model; unset Nova Pro is 'off'", async () => {
    process.env.NOVA_PRO_MODEL = "m/x";
    process.env.NOVA_PRO_API_KEY = "k";
    global.fetch = (async () => new Response("no", { status: 401 })) as any;
    expect(await coderChat([{ role: "user", content: "hi" }], { model: "nova_pro" })).toEqual({ reply: null, failure: "http" });
    delete process.env.NOVA_PRO_MODEL;
    const spy = jest.fn();
    global.fetch = spy as any;
    expect(await coderChat([{ role: "user", content: "hi" }], { model: "nova_pro" })).toEqual({ reply: null, failure: "off" });
    expect(spy).not.toHaveBeenCalled();
  });
});
