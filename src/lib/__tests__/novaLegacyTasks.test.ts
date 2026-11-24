// Review note #1198 §2.2 item 3: Nova is ONE model. A run started while the app still had a separate "Nova 2" entry belongs
// to Nova now — it has to appear in Nova's list, otherwise it is invisible in the app and keeps using the Studio with no way
// to stop it. Sham and donor runs must never appear.
import { tasksOfModel } from "@/lib/coderChats";

const tasks = [
  { run_id: "nova-plain", slot: "" },
  { run_id: "nova-scheduled", slot: "s:0123456789ab" },
  { run_id: "nova-own-slot", slot: "model:coder" },
  { run_id: "legacy-slot", slot: "model:nova2" },
  { run_id: "legacy-thread", slot: "" },
  { run_id: "sham-1", slot: "sham" },
  { run_id: "sham-1-alias", slot: "sham_v1" },
  { run_id: "sham-pro", slot: "sham_v2" },
  { run_id: "donor", slot: "donor:qwen" },
];

const ids = async (model: "coder" | "nova2" | "sham" | "sham_v2") =>
  (await tasksOfModel(4242, model, tasks, {} as never)).map((t) => t.run_id);

describe("Nova keeps the runs of the retired Nova 2 entry (review note #1198 §2.2)", () => {
  test("Nova's list holds every Nova-family run, including the legacy nova2 slot and runs of the old private chat", async () => {
    expect(await ids("coder")).toEqual(["nova-plain", "nova-scheduled", "nova-own-slot", "legacy-slot", "legacy-thread"]);
  });

  test("a Sham or donor run is never handed to Nova", async () => {
    const nova = await ids("coder");
    for (const other of ["sham-1", "sham-1-alias", "sham-pro", "donor"]) expect(nova).not.toContain(other);
  });

  test("the Sham models keep their own narrow lists", async () => {
    expect(await ids("sham")).toEqual(["sham-1", "sham-1-alias"]);
    expect(await ids("sham_v2")).toEqual(["sham-pro"]);
  });

  test("the Nova 2 engine id still sees only what it filed itself", async () => {
    expect(await ids("nova2")).toEqual(["legacy-slot"]);
  });
});
