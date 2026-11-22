// The execution gate (coderFinishGate.execNudge) must be reached in the real chat loop: a request «…ونفّذه على حاسوبك…» answered with text and no tool call is sent back to work.
import { handleCoderSections } from "@/lib/coderSections";
import { listTasks } from "@/lib/coderTasks";
import { fakeBot } from "./coderFakes";
import { pgDb, resetPg } from "./pgDb";

jest.mock("dns/promises", () => ({ lookup: jest.fn(async () => [{ address: "93.184.216.34", family: 4 }]) }));

const FREE = 9101;
const botRow = { id: "bot1", token: "T", webhookSecret: "whs", isActive: true, template: "NOVA_BOT" } as any;
const sse = (o: object) => `event: complete\ndata: [${JSON.stringify(JSON.stringify(o))}]\n`;
const db = (): any => pgDb();
const wait = (ms = 50) => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => Promise<boolean> | boolean, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await wait(40); } return false; };

beforeEach(async () => {
  await resetPg();
  process.env.OPEN_CODER_STUDIO_URL = "https://coder.test";
  process.env.MODELSCOPE_API_TOKEN = "ms";
  process.env.CODER_POLL_MS = "5";
  process.env.CODER_TOKEN_KEY = "test-key";
  delete process.env.SHAM_STUDIO_URL; delete process.env.SHAM_V2_URL;
});

it("a run request that was answered with text only is sent back to work (the harness message reaches the model)", async () => {
  const bodies: string[] = [];
  jest.spyOn(global, "fetch" as any).mockImplementation((async (input: any, init?: any) => {
    const url = String(input?.url || input);
    if (url.includes("/gradio_api/call/")) {
      if (String(init?.method || "GET").toUpperCase() === "POST") { bodies.push(String(init?.body || "")); return new Response(JSON.stringify({ event_id: "e1" }), { status: 200 }); }
      return new Response(sse({ type: "done", job: "j", text: "سأكتب الكود: print([i*i for i in range(1,6)]) والناتج 1 4 9 16 25", tool_calls: [] }), { status: 200 });
    }
    return new Response("{}", { status: 202 });
  }) as any);
  const { bot } = fakeBot();
  await handleCoderSections(bot, botRow, { message: { chat: { id: FREE }, from: { id: FREE, first_name: "Ali" }, text: "اكتب برنامج بايثون يطبع مربعات الأعداد من 1 إلى 5 ونفّذه على حاسوبك وأخبرني بالناتج." } }, db());
  const ok = await until(() => bodies.some((b) => b.includes("[harness] The user asked you to RUN")));
  if (!ok) console.log("STUDIO CALLS", bodies.length, bodies.map((b) => b.slice(0, 200)));
  expect(ok).toBe(true);
  // let the run finish BEFORE the test ends: a run still querying a closed database killed the whole jest process with EPIPE in CI (#1159 first attempt)
  expect(await until(async () => { const t = (await listTasks(FREE, { limit: 5 }, db()))[0]; return !!t && ["done", "failed"].includes(String(t.status)); }, 30000)).toBe(true);
}, 70000);
