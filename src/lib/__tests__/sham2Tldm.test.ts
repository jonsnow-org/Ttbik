import { setTldmEnabled, tldmAllowedFor, tldmEnabled, tldmOpenToAll } from "@/lib/coderModels";
import { shamConfirmText } from "@/lib/shamExec";
import { shamGenerateChat, shamGenerateTldm, shamModeCtx, shamTldmCtx, shamTldmOn, shamTldmSessionId, shamVariant } from "@/lib/shamStudio";

function sseFetch(data: string) {
  const chunk = new TextEncoder().encode(data.endsWith("\n") ? data : data + "\n");
  let sent = false;
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: async () => {
          if (sent) return { done: true, value: undefined };
          sent = true;
          return { done: false, value: chunk };
        },
        cancel: async () => undefined,
        releaseLock() {},
      }),
    },
    text: async () => data,
  } as any;
}

describe("Sham 2 T-LDM owner path", () => {
  it("is off by default and only stored on Sham 2", () => {
    const st: any = {};
    expect(tldmEnabled(st, "sham_v2")).toBe(false);
    expect(tldmEnabled(st, "sham")).toBe(false);
    setTldmEnabled(st, true);
    expect(tldmEnabled(st, "sham_v2")).toBe(true);
    expect(tldmEnabled(st, "sham")).toBe(false);
    setTldmEnabled(st, false);
    expect(tldmEnabled(st, "sham_v2")).toBe(false);
  });

  it("is active only on the Sham 2 variant", () => {
    expect(shamTldmOn()).toBe(false);
    expect(shamVariant.run("v1", () => shamTldmCtx.run(true, () => shamTldmOn()))).toBe(false);
    expect(shamVariant.run("v2", () => shamTldmCtx.run(true, () => shamTldmOn()))).toBe(true);
    expect(shamVariant.run("v2", () => shamModeCtx.run({ tldm: true } as never, () => shamTldmOn()))).toBe(true);
    expect(shamVariant.run("v2", () => shamModeCtx.run({} as never, () => shamTldmOn()))).toBe(false);
  });

  it("calls generate_tldm for Sham 2 and never Sham 1 when the switch is on", async () => {
    process.env.MODELSCOPE_API_TOKEN = "t";
    const urls: string[] = [];
    const real = global.fetch;
    global.fetch = (async (input: any, init?: any) => {
      urls.push(String(input));
      if (String(input).includes("/call/v2/")) {
        return { ok: true, json: async () => ({ event_id: "e1" }) } as any;
      }
      return sseFetch('data: [{"type":"error","text":"مسار T-LDM لشام 2 غير جاهز: لم يُعثر على رأس التدريب. لم يُستخدم شام 1.","fallback":"none"}]\n');
    }) as any;
    try {
      const reply = await shamVariant.run("v2", () => shamTldmCtx.run(true, () => shamGenerateChat([{ role: "user", content: "مرحبا" }])));
      expect(reply).toMatchObject({ type: "error" });
      expect(String(reply?.text || "")).toContain("شام 1");
      expect(urls.some((u) => u.includes("generate_tldm"))).toBe(true);
      expect(urls.some((u) => u.includes("sham-v1") || u.includes("generate_chat"))).toBe(false);
    } finally {
      global.fetch = real;
      delete process.env.MODELSCOPE_API_TOKEN;
    }
  });

  it("resumes an app read-only tool request on the same T-LDM Studio", async () => {
    process.env.MODELSCOPE_API_TOKEN = "t";
    const payloads: any[] = [], urls: string[] = [];
    const real = global.fetch;
    global.fetch = (async (input: any, init?: any) => {
      urls.push(String(input));
      if (init?.body) payloads.push(JSON.parse(String(init.body)));
      if (String(input).includes("/call/v2/")) return { ok: true, json: async () => ({ event_id: "e1" }) } as any;
      const body = payloads.some((p) => p.resume_tool_request_id === "req-9")
        ? 'data: [{"type":"text","text":"تم البحث والتلخيص","tldm":true}]\n'
        : 'data: [{"type":"tool_request","tool_name":"web_search","tool_arguments":{"query":"test"},"tool_request_id":"req-9","tldm":true}]\n';
      return sseFetch(body);
    }) as any;
    try {
      const messages = [{ role: "user" as const, content: "ابحث في الويب عن test" }];
      const first = await shamVariant.run("v2", () => shamGenerateTldm(messages, "tldm-sham_v2-9"));
      expect(first).toMatchObject({ type: "tool_request", tool_name: "web_search", tool_request_id: "req-9" });
      expect(first?.tldmBase).toContain("sham-v2");
      const second = await shamVariant.run("v2", () => shamGenerateTldm(messages, "tldm-sham_v2-9", 180000, {
        resumeTool: { requestId: "req-9", name: "web_search", arguments: { query: "test" }, result: "result: test page", routeBase: first?.tldmBase },
      }));
      expect(second).toMatchObject({ type: "text", text: "تم البحث والتلخيص" });
      expect(payloads[1]).toMatchObject({ resume_tool_name: "web_search", resume_tool_request_id: "req-9", resume_tool_arguments_json: JSON.stringify({ query: "test" }), resume_tool_result: "result: test page" });
      const resultUrls = urls.filter((u) => !u.includes("/call/v2/"));
      expect(resultUrls).toHaveLength(2);
      expect(resultUrls[0].split("/gradio_api/")[0]).toBe(resultUrls[1].split("/gradio_api/")[0]);
    } finally {
      global.fetch = real;
      delete process.env.MODELSCOPE_API_TOKEN;
    }
  });

  it("returns a clear no-fallback error if the T-LDM endpoint does not answer", async () => {
    process.env.MODELSCOPE_API_TOKEN = "t";
    const real = global.fetch;
    global.fetch = (async () => ({ ok: false, status: 404 })) as any;
    try {
      const reply = await shamVariant.run("v2", () => shamGenerateTldm([{ role: "user", content: "مرحبا" }]));
      expect(reply).toMatchObject({ type: "error", reason: "no-fallback" });
      expect(String(reply?.text || "")).toContain("شام 1");
    } finally {
      global.fetch = real;
      delete process.env.MODELSCOPE_API_TOKEN;
    }
  });

  it("refuses to run T-LDM on Sham 1", async () => {
    const reply = await shamVariant.run("v1", () => shamGenerateTldm([{ role: "user", content: "مرحبا" }]));
    expect(reply).toMatchObject({ type: "error", reason: "no-fallback" });
    expect(String(reply?.text || "")).toContain("شام برو");
  });

  it("is owner-only by default and opens to every user through one switch", () => {
    const prev = process.env.SHAM_TLDM_OPEN;
    delete process.env.SHAM_TLDM_OPEN;
    expect(tldmOpenToAll("sham_v2")).toBe(false);
    expect(tldmAllowedFor("owner", "sham_v2")).toBe(true);
    expect(tldmAllowedFor("user", "sham_v2")).toBe(false);
    expect(tldmAllowedFor(undefined, "sham_v2")).toBe(false);
    process.env.SHAM_TLDM_OPEN = "1";
    expect(tldmOpenToAll("sham_v2")).toBe(true);
    expect(tldmAllowedFor("user", "sham_v2")).toBe(true);
    expect(tldmAllowedFor("owner", "sham_v2")).toBe(true);
    if (prev === undefined) delete process.env.SHAM_TLDM_OPEN;
    else process.env.SHAM_TLDM_OPEN = prev;
  });

  it("does not let a non-owner reach the path just because state has the flag", () => {
    const st: any = {};
    setTldmEnabled(st, true, "sham_v2");
    expect(tldmEnabled(st, "sham_v2")).toBe(true);
    expect(tldmAllowedFor("user", "sham_v2") && tldmEnabled(st, "sham_v2")).toBe(false);
    expect(tldmAllowedFor("owner", "sham_v2") && tldmEnabled(st, "sham_v2")).toBe(true);
  });

  it("keys each chat to an isolated session on Sham 2's computer", () => {
    expect(shamTldmSessionId(42)).toBe("tldm-sham_v2-42");
    expect(shamTldmSessionId()).toBe("default");
  });

  it("sends the owner deny-list with the T-LDM request", async () => {
    process.env.MODELSCOPE_API_TOKEN = "t";
    const { _setTldmPolicyForTests } = await import("@/lib/tldmPolicy");
    _setTldmPolicyForTests("sham_v2", true, ["rm -rf"]);
    const payloads: any[] = [];
    const real = global.fetch;
    global.fetch = (async (input: any, init?: any) => {
      if (init?.body) payloads.push(JSON.parse(String(init.body)));
      if (String(input).includes("/call/v2/")) return { ok: true, json: async () => ({ event_id: "e1" }) } as any;
      return sseFetch('data: [{"type":"text","text":"ok","tldm":true}]\n');
    }) as any;
    try {
      const { shamGenerateTldm, shamVariant } = await import("@/lib/shamStudio");
      await shamVariant.run("v2", () => shamGenerateTldm([{ role: "user", content: "مرحبًا" }], "tldm-sham_v2-1"));
      expect(payloads.some((p) => String(p.deny_list || "").includes("rm -rf"))).toBe(true);
    } finally {
      global.fetch = real;
      delete process.env.MODELSCOPE_API_TOKEN;
      _setTldmPolicyForTests("sham_v2", false, []);
    }
  });

  it("surfaces a confirm reply for the existing allow/deny flow and can resume it", async () => {
    process.env.MODELSCOPE_API_TOKEN = "t";
    const payloads: any[] = [];
    const real = global.fetch;
    global.fetch = (async (input: any, init?: any) => {
      if (init?.body) payloads.push(JSON.parse(String(init.body)));
      if (String(input).includes("/call/v2/")) {
        return { ok: true, json: async () => ({ event_id: "e1" }) } as any;
      }
      const body = payloads.some((p) => p.confirm_ok === 1)
        ? 'data: [{"type":"text","text":"تم","tldm":true,"computer":"model_computer"}]\n'
        : 'data: [{"type":"confirm","text":"اسمح؟","command":"rm x","session":"tldm-sham_v2-7","tldm":true,"computer":"model_computer"}]\n';
      return sseFetch(body);
    }) as any;
    try {
      const confirm = await shamVariant.run("v2", () => shamGenerateTldm([{ role: "user", content: "افعل" }], "tldm-sham_v2-7"));
      expect(confirm).toMatchObject({ type: "confirm", command: "rm x", computer: "model_computer", session: "tldm-sham_v2-7" });
      expect(shamConfirmText({ function: { name: "tldm_confirm", arguments: JSON.stringify({ command: "rm x" }) } } as any)).toContain("حاسوب شام برو");
      const done = await shamVariant.run("v2", () => shamGenerateTldm([{ role: "user", content: "افعل" }], "tldm-sham_v2-7", 180000, { resume: { command: "rm x", approved: true } }));
      expect(done).toMatchObject({ type: "text", text: "تم" });
      expect(payloads.some((p) => p.session === "tldm-sham_v2-7" && p.confirm_cmd === "rm x" && p.confirm_ok === 1)).toBe(true);
    } finally {
      global.fetch = real;
      delete process.env.MODELSCOPE_API_TOKEN;
    }
  });

  it("omits the deny-list when the caller is the owner", async () => {
    process.env.MODELSCOPE_API_TOKEN = "t";
    const { _setTldmPolicyForTests } = await import("@/lib/tldmPolicy");
    _setTldmPolicyForTests("sham_v2", true, ["rm -rf"]);
    const payloads: any[] = [];
    const real = global.fetch;
    global.fetch = (async (input: any, init?: any) => {
      if (init?.body) payloads.push(JSON.parse(String(init.body)));
      if (String(input).includes("/call/v2/")) return { ok: true, json: async () => ({ event_id: "e1" }) } as any;
      return sseFetch('data: [{"type":"text","text":"ok","tldm":true}]\n');
    }) as any;
    try {
      const { shamGenerateTldm, shamVariant } = await import("@/lib/shamStudio");
      await shamVariant.run("v2", () => shamGenerateTldm([{ role: "user", content: "مرحبًا" }], "tldm-sham_v2-1", 180000, { owner: true }));
      expect(payloads.some((p) => p.owner === 1 && !p.deny_list)).toBe(true);
    } finally {
      global.fetch = real;
      delete process.env.MODELSCOPE_API_TOKEN;
      _setTldmPolicyForTests("sham_v2", false, []);
    }
  });
});
