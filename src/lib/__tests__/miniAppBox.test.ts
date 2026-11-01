// The Mini App's Computer tab: a real shell / files on the model's own free computer, owner only, same private session the model uses.
import { appOp, AppError } from "@/lib/coderApp";
import { fakeBot } from "./coderFakes";
import { pgDb, resetPg } from "./pgDb";

const OWNER = 4242, USER = 9001;
const botRow = { id: "bot1", token: "T", webhookSecret: "whs", isActive: true, template: "NOVA_BOT" } as any;
beforeEach(async () => { await resetPg(); process.env.SUPER_ADMIN_TELEGRAM_ID = String(OWNER); process.env.MODELSCOPE_API_TOKEN = "ms"; process.env.CODER_TOKEN_KEY = "k"; process.env.NOVA_MEDIA_STUDIO_URL = "https://media.test"; });

it("owner runs a command on a model's computer (private session = chat:model); a user is refused", async () => {
  const db: any = pgDb(); const { bot } = fakeBot();
  const seen: any[] = [];
  const fetchImpl = (async (url: string, init?: any) => {
    if (init?.method === "POST") { const data = JSON.parse(init.body).data[0]; seen.push(JSON.parse(data.startsWith("b64:") ? Buffer.from(data.slice(4), "base64").toString("utf8") : data)); return new Response('{"event_id":"e1"}', { status: 200 }); }
    return new Response(`event: complete\ndata: ${JSON.stringify([JSON.stringify({ ok: true, exit_code: 0, output: "a\nb\n", seconds: 0.1 })])}\n\n`, { status: 200 });
  }) as unknown as typeof fetch;
  const d = { db, bot, botRow, fetchImpl };
  const r: any = await appOp({ chatId: OWNER, tier: "owner" }, "box", { model: "coder", args: { action: "run", command: "echo a; echo b", cwd: "." } }, d as any);
  expect(r).toMatchObject({ ok: true, output: "a\nb\n" });
  expect(seen[0]).toMatchObject({ action: "run", command: "echo a; echo b", session: `${OWNER}:coder` });
  await expect(appOp({ chatId: USER, tier: "user" }, "box", { model: "coder", args: { action: "run", command: "id" } }, d as any)).rejects.toThrow(AppError);
});
