// Executable proof of the Sham Pro change (src/lib/shamAgent.ts): the saved-skills database read is lazy.
//
// It runs the REAL shamAgentRun loop (v2 variant) with an injected model answer, an injected tool executor and a fake db
// that records every sham_skills query. No network, no token. Run:
//   cd athar && npx jest --config ../jest.media.config.js --rootDir .. --runInBand src/lib/__tests__/shamProLatency.test.ts
import { shamAgentRun } from "@/lib/shamAgent";
import { shamVariant } from "@/lib/shamStudio";

const skillTool = { type: "function", function: { name: "skill_list", description: "list skills", parameters: { type: "object", properties: {} } } } as never;

/** A db that counts only the saved-skills read (listShamSkills), so a greeting is asserted to touch it zero times. */
function fakeDb() {
  const skillReads: string[] = [];
  const db = {
    query: async (sql: string) => {
      if (/from\s+sham_skills/i.test(String(sql))) skillReads.push(String(sql));
      return [];
    },
    exec: async () => undefined,
  };
  return { db: db as never, skillReads };
}

const ctx = (db: unknown, owner = false) => ({ chatId: 1, botId: "b1", db, githubToken: null, chatKey: "k1", runId: "r1", modelId: "sham_v2", owner }) as never;
const say = (text: string) => ({ type: "text", text }) as never;
const callSkillList = () => ({ type: "tool_calls", tool_calls: [{ function: { name: "skill_list", arguments: "{}" } }] }) as never;

describe("Sham Pro: the saved-skills read is lazy", () => {
  it("a tool-less first step (a greeting) reads the database zero times", async () => {
    const { db, skillReads } = fakeDb();
    const r = await shamVariant.run("v2", () =>
      shamAgentRun({
        text: "مرحبا",
        ctx: ctx(db),
        tools: [skillTool],
        budgetMs: 60000,
        maxSteps: 2,
        ask: async () => say("أهلاً بك"),
        agentAsk: async () => say("أهلاً بك"),
      })
    );
    expect(r.kind).not.toBe("ask");
    expect(skillReads.length).toBe(0);
  });

  it("a tool-bearing run reads the skills once, even across two steps", async () => {
    const { db, skillReads } = fakeDb();
    let step = 0;
    const r = await shamVariant.run("v2", () =>
      shamAgentRun({
        text: "اقرأ المشروع واكتب لي تقريراً قصيراً عن بنيته",
        ctx: ctx(db),
        tools: [skillTool],
        budgetMs: 60000,
        maxSteps: 3,
        ask: async () => say("تم"),
        // step 1 asks for a tool (so the step has tools), step 2 answers: two tool-bearing steps, one read.
        agentAsk: async () => (++step === 1 ? callSkillList() : say("تم")),
        exec: async () => "لا مهارات محفوظة بعد.",
      })
    );
    expect(r.kind).not.toBe("ask");
    expect(skillReads.length).toBe(1);
    expect(step).toBeGreaterThanOrEqual(2);
  });
});
