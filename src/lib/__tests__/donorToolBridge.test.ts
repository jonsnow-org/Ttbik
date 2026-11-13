import { CANDIDATE_GROUPS, candidateToolsFor } from "@/lib/donorToolBridge";

const names = (groups: readonly string[], gh = true, conn = true) => candidateToolsFor(groups, gh, conn).map((t) => t.function.name);

describe("candidate tool groups", () => {
  test("the groups give a candidate GitHub, a persistent computer, the web and linked services", () => {
    const all = names(CANDIDATE_GROUPS);
    expect(all).toEqual(expect.arrayContaining(["github_read_file", "github_write_files", "computer_run", "computer_read", "browser", "desktop", "web_search", "fetch_page", "connector_api"]));
  });

  test("candidates have the same tool groups as Nova: media, memory, schedules, publish and viewing are offered too", () => {
    const all = names(CANDIDATE_GROUPS);
    for (const wanted of ["make_media", "view_image", "view_video", "send_file", "plan", "memory_save", "memory_search", "recall", "schedule_create", "schedule_list", "computer_publish", "sandbox_exec"]) {
      expect(all).toContain(wanted);
    }
  });

  test("github tools need a linked GitHub account, connector_api needs a linked service", () => {
    expect(names(["github"], false, true)).toEqual([]);
    expect(names(["connectors"], true, false)).toEqual([]);
    expect(names(["connectors"], true, true)).toContain("connector_api");
  });

  test("an unknown group gives nothing and schemas stay short", () => {
    expect(names(["../etc", "nothing"])).toEqual([]);
    for (const t of candidateToolsFor(CANDIDATE_GROUPS, true, true)) expect(t.function.description.length).toBeLessThanOrEqual(170);
  });
});

describe("computer tools under the zero-cost policy (production)", () => {
  const withEnv = (value: string, fn: () => void) => {
    const original = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = value;
    try { fn(); } finally { (process.env as Record<string, string | undefined>).NODE_ENV = original; }
  };
  test("each candidate receives only its own persistent ModelScope computer and browser, not a second task VM", () => {
    withEnv("production", () => {
      const all = names(["computer"]);
      expect(all).toEqual(expect.arrayContaining(["computer_run", "computer_write", "computer_read", "computer_job", "computer_repo", "computer_search", "browser"]));
        expect(all.every((n) => !n.startsWith("cloud_"))).toBe(true);
    });
  });
});
