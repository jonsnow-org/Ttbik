// A Sham that chose to show its screen leaves a "screen" event; the owner's Mini App opens the screen by itself. Proven on a real SQL engine.
import { appOp } from "@/lib/coderApp";
import { taskStart, taskEvent, latestScreenOffer } from "@/lib/coderTasks";
import { pgDb, resetPg } from "./pgDb";

const OWNER = 4242;
const db = (): any => pgDb();

beforeEach(async () => { await resetPg(); });

describe("screen offers", () => {
  test("a fresh screen event of this chat is offered once with its model; old, foreign and non-Sham events are not", async () => {
    await taskStart(OWNER, { runId: "run-screen-1", slot: "sham_v2", title: "t", source: "interactive" }, db());
    expect(await latestScreenOffer(OWNER, db())).toBeNull();
    await taskEvent("run-screen-1", "screen", JSON.stringify({ model: "sham_v2" }), db());
    const offer = await latestScreenOffer(OWNER, db());
    expect(offer).toMatchObject({ model: "sham_v2" });
    expect(await latestScreenOffer(9999, db())).toBeNull();                       // another chat sees nothing
    await taskEvent("run-screen-1", "screen", JSON.stringify({ model: "coder" }), db());     // Nova's hub is not a Sham offer
    expect((await latestScreenOffer(OWNER, db()))?.id).toBe(offer?.id);
    const second = await taskEvent("run-screen-1", "screen", JSON.stringify({ model: "sham" }), db());
    void second;
    expect((await latestScreenOffer(OWNER, db()))?.model).toBe("sham");                    // a newer Sham offer wins
  });
});
