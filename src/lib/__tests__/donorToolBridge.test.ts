import { CANDIDATE_GROUPS, candidateToolsFor } from "@/lib/donorToolBridge";

const names = (groups: readonly string[], gh = true, conn = true) => candidateToolsFor(groups, gh, conn).map((t) => t.function.name);

describe("candidate tool groups", () => {
  test("the four groups give a candidate GitHub, a computer, the web and linked services", () => {
    const all = names(CANDIDATE_GROUPS);
    expect(all).toEqual(expect.arrayContaining(["github_read_file", "github_write_files", "sandbox_exec", "web_search", "fetch_page", "connector_api"]));
  });

  test("nothing that would reach into another model is ever offered", () => {
    const all = names(CANDIDATE_GROUPS);
    for (const blocked of ["make_media", "delegate", "schedule_create", "schedule_list", "memory_save", "memory_search", "recall", "send_file", "ask_user"]) {
      expect(all).not.toContain(blocked);
    }
  });

  test("github tools need a linked GitHub account, connector_api needs a linked service", () => {
    expect(names(["github"], false, true)).toEqual([]);
    expect(names(["connectors"], true, false)).toEqual([]);
    expect(names(["connectors"], true, true)).toContain("connector_api");
  });

  test("an unknown group gives nothing and schemas stay short", () => {
    expect(names(["media", "memory", "schedule", "../etc"])).toEqual([]);
    for (const t of candidateToolsFor(CANDIDATE_GROUPS, true, true)) expect(t.function.description.length).toBeLessThanOrEqual(170);
  });
});
