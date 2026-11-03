// Owner t88u (2026-11-04): every model (the three candidates and LFM2.5 too) has a show-to-everyone / hide switch; a regular user reaches a
// candidate's tools only while the switch shows it, and never gets the owner's tier there.
import { pgDb } from "./pgDb";
import { listModels, publicModels, updateModel } from "@/lib/coderModels";
import { candidateOpenTo } from "@/lib/donorToolBridge";

const OWNER = 4242;
const USER = 777;

beforeAll(() => {
  process.env.SUPER_ADMIN_TELEGRAM_ID = String(OWNER);
  process.env.MODELSCOPE_API_TOKEN = "test-token";
});

test("the owner's switch shows and hides every non-v1 model, candidates and LFM2.5 included", async () => {
  const db: any = pgDb();
  for (const id of ["qwen35-9b", "gemma4-e4b", "minicpmo45", "lfm25", "sham_v2", "coder"]) {
    await updateModel(id, { visible: true }, db);
    expect(publicModels(await listModels(db), undefined).map((m) => m.id)).toContain(id);
    await updateModel(id, { visible: false }, db);
    expect(publicModels(await listModels(db), undefined).map((m) => m.id)).not.toContain(id);
  }
  await updateModel("coder", { visible: true }, db);
});

test("a regular user reaches a candidate only while it is shown; the owner always", async () => {
  const db: any = pgDb();
  expect(await candidateOpenTo(OWNER, "gemma4-e4b", db)).toBe(true);
  expect(await candidateOpenTo(USER, "gemma4-e4b", db)).toBe(false);
  await updateModel("gemma4-e4b", { visible: true }, db);
  expect(await candidateOpenTo(USER, "gemma4-e4b", db)).toBe(true);
  await updateModel("gemma4-e4b", { visible: false }, db);
  expect(await candidateOpenTo(USER, "gemma4-e4b", db)).toBe(false);
});
