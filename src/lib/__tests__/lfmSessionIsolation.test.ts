import { withEngineModel } from "@/lib/openCoderStudio";
import { engineModelForRun, ensureLfmSessionState, loadStateStrict, saveStateStrict, signContinue, stateKey, verifyContinue } from "@/lib/coderSections";
import { saveMemory, listMemories } from "@/lib/coderMemory";
import * as Threads from "@/lib/coderThreads";
import { pgDb, resetPg } from "./pgDb";

const OWNER = 4242;

beforeEach(async () => {
  await resetPg();
  process.env.CODER_TOKEN_KEY = "lfm-session-test-key";
});

describe("LFM2.5 conversation isolation", () => {
  it("binds signed task continuations to LFM2.5 while accepting the legacy Nova signature", () => {
    const legacy = signContinue("secret", "bot", String(OWNER), "chain");
    expect(verifyContinue("secret", "bot", String(OWNER), "chain", legacy)).toBe(true);
    expect(verifyContinue("secret", "bot", String(OWNER), "chain", legacy, "coder")).toBe(true);
    const lfm = signContinue("secret", "bot", String(OWNER), "chain", "lfm25");
    expect(verifyContinue("secret", "bot", String(OWNER), "chain", lfm, "lfm25")).toBe(true);
    expect(verifyContinue("secret", "bot", String(OWNER), "chain", lfm, "coder")).toBe(false);
  });

  it("keeps state, transcript, active run, thread IDs and notes separate from Nova while syncing account preferences", async () => {
    const db = pgDb();
    const nova = await withEngineModel("coder", async () => {
      const st = await loadStateStrict(OWNER, db);
      st.model = "lfm25";
      st.lang = "ar";
      st.repo = "owner/nova-project";
      st.notes = "Nova private notes";
      st.convId = "nova-conversation";
      st.threadId = "nova-thread";
      st.messages = [{ role: "user", content: "هذه محادثة Nova فقط" }];
      st.run = { id: "nova-run", chain: "nova-chain", sent: 0, step: 1, lease: Date.now() } as any;
      st.perModel = { lfm25: { think: false, accuracy: "fast" } } as any;
      st.memPer = { lfm25: { recall: true, remember: true } } as any;
      await saveStateStrict(OWNER, st, db);
      return st;
    });

    const lfm = await withEngineModel("lfm25", () => ensureLfmSessionState(OWNER, db));
    expect(lfm.model).toBe("lfm25");
    expect(lfm.lang).toBe("ar");
    expect(lfm.repo).toBe("owner/nova-project");
    expect(lfm.messages).toEqual([]);
    expect(lfm.notes).toBe("");
    expect(lfm.convId).toBeUndefined();
    expect(lfm.threadId).toBeUndefined();
    expect(lfm.run).toBeNull();
    expect(lfm.perModel?.lfm25).toEqual({ think: false, accuracy: "fast" });

    await withEngineModel("lfm25", async () => {
      const own = await loadStateStrict(OWNER, db);
      own.messages.push({ role: "user", content: "محادثة LFM2.5 فقط" });
      own.notes = "LFM private notes";
      own.threadId = "lfm-thread";
      await saveStateStrict(OWNER, own, db);
    });

    const novaAfter = await withEngineModel("coder", () => loadStateStrict(OWNER, db));
    const lfmAfter = await withEngineModel("lfm25", () => loadStateStrict(OWNER, db));
    expect(novaAfter.messages).toEqual(nova.messages);
    expect(novaAfter.notes).toBe("Nova private notes");
    expect(novaAfter.threadId).toBe("nova-thread");
    expect(novaAfter.run?.id).toBe("nova-run");
    expect(lfmAfter.messages.map((m) => m.content)).toEqual(["محادثة LFM2.5 فقط"]);
    expect(lfmAfter.notes).toBe("LFM private notes");
    expect(lfmAfter.threadId).toBe("lfm-thread");
    expect(withEngineModel("coder", () => stateKey(OWNER))).not.toBe(withEngineModel("lfm25", () => stateKey(OWNER)));
  });

  it("finds a task's owning model after the account selector has changed", async () => {
    const db = pgDb();
    await withEngineModel("coder", async () => {
      const st = await loadStateStrict(OWNER, db);
      st.model = "coder";
      st.run = { id: "nova-live-run", chain: "n", sent: 0, step: 1, lease: Date.now() } as any;
      await saveStateStrict(OWNER, st, db);
    });
    await withEngineModel("lfm25", async () => {
      const st = await loadStateStrict(OWNER, db);
      st.model = "lfm25";
      st.run = { id: "lfm-live-run", chain: "l", sent: 0, step: 1, lease: Date.now() } as any;
      await saveStateStrict(OWNER, st, db);
    });
    expect(await engineModelForRun(OWNER, "nova-live-run", db)).toBe("coder");
    expect(await engineModelForRun(OWNER, "lfm-live-run", db)).toBe("lfm25");
    expect(await engineModelForRun(OWNER, "unknown-run", db)).toBeUndefined();
  });

  it("keeps LFM2.5 chat threads and long-term memory out of Nova's stores", async () => {
    const db = pgDb();
    const novaThread = await Threads.createThread(OWNER, { title: "Nova thread", messages: [{ role: "user", content: "Nova history" }] }, db);
    const lfmThread = await Threads.createThread(`${OWNER}#model:lfm25`, { title: "LFM thread", messages: [{ role: "user", content: "LFM history" }] }, db);

    const novaThreads = await Threads.listThreads(OWNER, {}, db);
    const lfmThreads = await Threads.listThreads(`${OWNER}#model:lfm25`, {}, db);
    expect(novaThreads.map((x) => x.id)).toContain(novaThread);
    expect(novaThreads.map((x) => x.id)).not.toContain(lfmThread);
    expect(lfmThreads.map((x) => x.id)).toContain(lfmThread);
    expect(lfmThreads.map((x) => x.id)).not.toContain(novaThread);

    await saveMemory(OWNER, { text: "Nova prefers concise progress reports", kind: "preference" }, db);
    await saveMemory(`${OWNER}#model:lfm25`, { text: "LFM2.5 uses Arabic replies by default", kind: "preference" }, db);
    expect((await listMemories(OWNER, db)).map((x) => x.text)).toEqual(["Nova prefers concise progress reports"]);
    expect((await listMemories(`${OWNER}#model:lfm25`, db)).map((x) => x.text)).toEqual(["LFM2.5 uses Arabic replies by default"]);
  });
});
