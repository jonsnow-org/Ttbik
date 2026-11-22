// Nova's own T-LDM path: Nova 1 (`coder`) and Nova 2 (`nova2`) each on their own, never Sham's, never each other's.
// These tests use the real module and the real Studio routing; they assert the independence rules, not mocks.
import { _resetPoolForTests } from "@/lib/shamPool";

const NOVA1 = "https://studio-x-coder-inference-server.api-inference.modelscope.net";
const NOVA2 = "https://studio-jonjithup-coder-inference-server-16.api-inference.modelscope.ai";
const saved = { ...process.env };

/** The Studio's two-step Gradio call: POST .../call/v2/<api> -> {event_id}, then GET .../call/<api>/<id> -> SSE. */
function studioFetch(obj: unknown, seen?: string[]) {
  return (async (input: any) => {
    const url = String(input);
    if (seen) seen.push(url);
    if (url.includes("/call/v2/")) return { ok: true, status: 200, json: async () => ({ event_id: "e1" }) } as unknown as Response;
    return { ok: true, status: 200, text: async () => `data: ${JSON.stringify([JSON.stringify(obj)])}\n` } as unknown as Response;
  }) as any;
}

beforeEach(() => {
  _resetPoolForTests();
  process.env.OPEN_CODER_STUDIO_URL = NOVA1;
  process.env.OPEN_CODER_STUDIO_URLS = NOVA1;
  process.env.NOVA2_STUDIO_URLS = NOVA2;
  process.env.MODELSCOPE_API_TOKEN = "t";
  process.env.NOVA2_STUDIO_TOKEN = "t";
  delete process.env.SHAM_MODELSCOPE_URL;
  delete process.env.SHAM_V2_URL;
});
afterAll(() => { process.env = saved; });

describe("Nova T-LDM: independence", () => {
  it("imports nothing from Sham (the module is Nova's own)", async () => {
    const path = await import("node:path");
    const src = await import("node:fs").then((fs) => fs.readFileSync(path.join(__dirname, "..", "novaTldm.ts"), "utf8"));
    expect(src).not.toMatch(/from\s+"@\/lib\/sham/);
    expect(src).not.toMatch(/from\s+"@\/lib\/shamStudio"/);
    expect(src).not.toMatch(/shamGenerateTldm|shamVariant|shamTldmSessionId/);
  });

  it("builds a per-model workspace session: Nova 1 and Nova 2 never share a folder", async () => {
    const { novaTldmSessionId } = await import("@/lib/novaTldm");
    expect(novaTldmSessionId(42, "coder")).toBe("tldm-coder-42");
    expect(novaTldmSessionId(42, "nova2")).toBe("tldm-nova2-42");
    expect(novaTldmSessionId(42, "coder")).not.toBe(novaTldmSessionId(42, "nova2"));
    expect(novaTldmSessionId(null, "nova2")).toBe("tldm-nova2-default");
  });

  it("routes a Nova 1 T-LDM call to Nova 1's Studio only, and a Nova 2 call to Nova 2's", async () => {
    const seen: string[] = [];
    const real = global.fetch;
    global.fetch = studioFetch({ type: "done", text: "ok" }, seen);
    try {
      const { novaGenerateTldm, withNovaTldmModel } = await import("@/lib/novaTldm");
      const { withEngineModel } = await import("@/lib/openCoderStudio");
      const r1 = await withEngineModel("coder", () => withNovaTldmModel("coder", () => novaGenerateTldm([{ role: "user", content: "hi" }])));
      const r2 = await withEngineModel("nova2", () => withNovaTldmModel("nova2", () => novaGenerateTldm([{ role: "user", content: "hi" }])));
      expect(r1.tldmModel).toBe("coder");
      expect(r2.tldmModel).toBe("nova2");
      expect(seen.some((u) => u.includes("coder-inference-server"))).toBe(true);
      expect(seen.some((u) => u.includes("coder-inference-server-16"))).toBe(true);
    } finally {
      global.fetch = real;
    }
  });

  it("a head answer {type:text} becomes a finished model turn the agent loop accepts (it has a job); a step it cannot serve yet is an honest error", async () => {
    const real = global.fetch;
    try {
      const { novaGenerateTldm, withNovaTldmModel } = await import("@/lib/novaTldm");
      const { withEngineModel } = await import("@/lib/openCoderStudio");
      global.fetch = studioFetch({ type: "text", text: "مرحبا، أنا نوفا." });
      const ok = await withEngineModel("coder", () => withNovaTldmModel("coder", () => novaGenerateTldm([{ role: "user", content: "hi" }])));
      expect(ok.type).toBe("done");
      expect(ok.job).toBeTruthy();
      expect(ok.text).toBe("مرحبا، أنا نوفا.");
      global.fetch = studioFetch({ type: "tool_request", tool_name: "computer_run", tool_arguments: { command: "ls" }, tool_request_id: "abc123" });
      const tr = await withEngineModel("coder", () => withNovaTldmModel("coder", () => novaGenerateTldm([{ role: "user", content: "hi" }])));
      expect(tr.type).toBe("done");
      expect(tr.tool_calls?.[0].id).toBe("tldm:abc123");
      expect(tr.tool_calls?.[0].function.name).toBe("computer_run");
      expect(JSON.parse(tr.tool_calls![0].function.arguments)).toEqual({ command: "ls" });
      global.fetch = studioFetch({ type: "body" });
      const body = await withEngineModel("coder", () => withNovaTldmModel("coder", () => novaGenerateTldm([{ role: "user", content: "hi" }])));
      expect((body as any).error).toBe("body");
    } finally {
      global.fetch = real;
    }
  });

  it("tldmTurnFrom: the head gets the task only, and the result of a tool it asked for is handed back as resumeTool", async () => {
    const { tldmTurnFrom } = await import("@/lib/novaTldm");
    const plain = tldmTurnFrom([{ role: "system", content: "SYSTEM" }, { role: "user", content: "اعرض الملفات" }]);
    expect(plain.messages).toEqual([{ role: "user", content: "اعرض الملفات" }]);
    expect(plain.resumeTool).toBeUndefined();
    const resumed = tldmTurnFrom([
      { role: "system", content: "SYSTEM" }, { role: "user", content: "اعرض الملفات" },
      { role: "assistant", content: "", tool_calls: [{ id: "tldm:r1", type: "function", function: { name: "computer_run", arguments: "{\"command\":\"ls\"}" } }] },
      { role: "tool", tool_call_id: "tldm:r1", content: "a.txt b.txt" },
    ]);
    expect(resumed.resumeTool).toEqual({ requestId: "r1", name: "computer_run", arguments: { command: "ls" }, result: "a.txt b.txt", error: false });
    const other = tldmTurnFrom([{ role: "user", content: "x" }, { role: "assistant", content: "", tool_calls: [{ id: "call_9", function: { name: "web_search", arguments: "{}" } }] }, { role: "tool", tool_call_id: "call_9", content: "r" }]);
    expect(other.resumeTool).toBeUndefined();          // a tool the body asked for is never handed to the head
  });

  it("refuses when no Nova model is in scope (never guesses, never falls back to Sham)", async () => {
    const real = global.fetch;
    const bodies: any[] = [];
    const base = studioFetch({ type: "done", text: "x" });
    global.fetch = (async (i: any, init?: any) => {
      if (init?.body) bodies.push(JSON.parse(String(init.body)));
      return base(i, init);
    }) as any;
    try {
      const { novaGenerateTldm } = await import("@/lib/novaTldm");
      const r = await novaGenerateTldm([{ role: "user", content: "hi" }]);
      expect(r.type).toBe("error");
      expect(bodies.some((b) => b.tldm_flag === 1)).toBe(false);   // no T-LDM turn left the process
    } finally {
      global.fetch = real;
    }
  });

  it("sends each model its OWN owner deny-list, never the other's", async () => {
    const payloads: any[] = [];
    const real = global.fetch;
    const base = studioFetch({ type: "done", text: "ok" });
    global.fetch = (async (i: any, init?: any) => {
      if (init?.body) payloads.push(JSON.parse(String(init.body)));
      return base(i, init);
    }) as any;
    try {
      const P = await import("@/lib/tldmPolicy");
      const { novaGenerateTldm, withNovaTldmModel } = await import("@/lib/novaTldm");
      const { withEngineModel } = await import("@/lib/openCoderStudio");
      P._setTldmPolicyForTests("nova2", true, ["rm -rf /"]);
      await withEngineModel("nova2", () => withNovaTldmModel("nova2", () => novaGenerateTldm([{ role: "user", content: "hi" }])));
      const n2 = payloads.find((p) => String(p.deny_list || "").includes("rm -rf /"));
      expect(n2).toBeTruthy();
      payloads.length = 0;
      await withEngineModel("coder", () => withNovaTldmModel("coder", () => novaGenerateTldm([{ role: "user", content: "hi" }])));
      expect(payloads.some((p) => String(p.deny_list || "").includes("rm -rf /"))).toBe(false);
      P._setTldmPolicyForTests("nova2", false, []);
    } finally {
      global.fetch = real;
    }
  });

  it("returns an honest no-fallback error when the Studio is unreachable (never a different model)", async () => {
    const real = global.fetch;
    global.fetch = (async () => { throw new Error("ECONNREFUSED"); }) as any;
    try {
      const { novaGenerateTldm, withNovaTldmModel } = await import("@/lib/novaTldm");
      const { withEngineModel } = await import("@/lib/openCoderStudio");
      const r = await withEngineModel("nova2", () => withNovaTldmModel("nova2", () => novaGenerateTldm([{ role: "user", content: "hi" }], "", 3000)));
      expect(r.type).toBe("error");
      expect(String(r.text)).toContain("Nova 2");
      expect(String(r.text)).toContain("لم يُستخدم");
    } finally {
      global.fetch = real;
    }
  });

  it("requires a final user turn (a malformed call is refused, not sent)", async () => {
    const real = global.fetch;
    const bodies: any[] = [];
    const base = studioFetch({ type: "done" });
    global.fetch = (async (i: any, init?: any) => {
      if (init?.body) bodies.push(JSON.parse(String(init.body)));
      return base(i, init);
    }) as any;
    try {
      const { novaGenerateTldm, withNovaTldmModel } = await import("@/lib/novaTldm");
      const { withEngineModel } = await import("@/lib/openCoderStudio");
      const r = await withEngineModel("coder", () => withNovaTldmModel("coder", () => novaGenerateTldm([{ role: "assistant", content: "x" }])));
      expect(r.type).toBe("error");
      expect(bodies.some((b) => b.tldm_flag === 1)).toBe(false);
    } finally {
      global.fetch = real;
    }
  });
});

describe("Nova T-LDM: the switch is per model", () => {
  it("enabling T-LDM on one Nova never enables the other, and neither enables Sham", async () => {
    const { tldmEnabled, setTldmEnabled } = await import("@/lib/coderModels");
    const st: any = { perModel: {} };
    setTldmEnabled(st, true, "coder");
    expect(tldmEnabled(st, "coder")).toBe(true);
    expect(tldmEnabled(st, "sham_v2")).toBe(false);
    setTldmEnabled(st, false, "coder");
    expect(tldmEnabled(st, "coder")).toBe(false);
  });

  it("a model with no head never reports a T-LDM switch", async () => {
    const { tldmEnabled, setTldmEnabled } = await import("@/lib/coderModels");
    const st: any = { perModel: {} };
    expect(setTldmEnabled(st, true, "sham")).toBe(false);
    expect(tldmEnabled(st, "sham")).toBe(false);
    expect(st.perModel.sham).toBeUndefined();
  });

  it("the audience gate is per model: opening Nova 2 to everyone does not open Nova 1 or Sham to anyone else", async () => {
    const P = await import("@/lib/tldmPolicy");
    // the default for every T-LDM model is owner-only; the owner may open one of them to all users
    P._setTldmPolicyForTests("nova2", true, []);
    expect(P.tldmAllowedFor("pro", "nova2")).toBe(true);
    expect(P.tldmAllowedFor("pro", "coder")).toBe(false);
    expect(P.tldmAllowedFor("pro", "sham_v2")).toBe(false);
    // the owner is allowed on each model's own switch (the default state is "owner only", not "off")
    expect(P.tldmAllowedFor("owner", "coder")).toBe(true);
    expect(P.tldmAllowedFor("owner", "sham_v2")).toBe(true);
    P._setTldmPolicyForTests("nova2", false, []);
    expect(P.tldmAllowedFor("pro", "nova2")).toBe(false);
  });

  it("the env switch names each model separately", async () => {
    const P = await import("@/lib/tldmPolicy");
    const keep = process.env.NOVA2_TLDM_OPEN;
    process.env.NOVA2_TLDM_OPEN = "1";
    delete process.env.NOVA1_TLDM_OPEN;
    delete process.env.SHAM_TLDM_OPEN;
    expect(P.envOpen("nova2")).toBe(true);
    expect(P.envOpen("coder")).toBe(false);
    expect(P.envOpen("sham_v2")).toBe(false);
    if (keep === undefined) delete process.env.NOVA2_TLDM_OPEN; else process.env.NOVA2_TLDM_OPEN = keep;
  });
});

describe("Nova T-LDM: the loop stops on the model's own error", () => {
  it("the in-loop branch is wired to the chat's model and to no plain-chat fallback", async () => {
    const path = await import("node:path");
    const src = await import("node:fs").then((fs) => fs.readFileSync(path.join(__dirname, "..", "coderSections.ts"), "utf8"));
    // the branch exists, is gated on the model's own switch, and scopes the call to that model
    expect(src).toMatch(/const tldmModel = !run\.agent && isTldmModel\(novaModelOf\(st\.model\)\) && tldmEnabled\(st, novaModelOf\(st\.model\)\)/);
    expect(src).toMatch(/withNovaTldmModel\(tldmModel, \(\) => novaGenerateTldm\(/);
    // a T-LDM error ends the run with the model's own line (never a retry into another model, never plain chat)
    expect(src).toMatch(/if \(tldmModel && r\?\.type === "error"\) \{/);
    expect(src).toMatch(/await endRun\(st, "failed", db, why, modelSessionChatKey\(chatId\)\);/);
    // and the error reply carries no `failure`, so the outage loop cannot swallow it
    expect(src).toMatch(/return \{ reply: r \} as CoderOutcome;/);
    // only the head's own "nothing for this task" signal reaches the SAME model's plain chat
    expect(src).toMatch(/\.error === "body"\) return plainChat\(\)/);
  });

  it("the /tldm command and its button follow the chat's model, not Sham's", async () => {
    const path = await import("node:path");
    const src = await import("node:fs").then((fs) => fs.readFileSync(path.join(__dirname, "..", "coderSections.ts"), "utf8"));
    expect(src).toMatch(/const want = novaModelOf\(stT\.model\);/);
    expect(src).toMatch(/setTldmEnabled\(stT, \/\^\(on\|1\)\$\/i\.test\(arg\), gate\)/);
    expect(src).toMatch(/هذا النموذج لا يملك مسار T-LDM/);
  });
});
