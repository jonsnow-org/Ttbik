import { CANDIDATE_GROUPS, candidateToolsFor } from "@/lib/donorToolBridge";

const names = (groups: readonly string[], gh = true, conn = true) => candidateToolsFor(groups, gh, conn).map((t) => t.function.name);

describe("candidate tool groups", () => {
  test("the four groups give a candidate GitHub, one persistent computer, the web and linked services", () => {
    const all = names(CANDIDATE_GROUPS);
    expect(all).toEqual(expect.arrayContaining(["github_read_file", "github_write_files", "cloud_computer_execute", "cloud_computer_screenshot", "cloud_computer_action", "web_search", "fetch_page", "connector_api"]));
    expect(all.some((name) => name.startsWith("sandbox_"))).toBe(false);
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

import { candidateMediaStudio } from "@/lib/photoWeightMedia";
describe("candidate media Studios", () => {
  test("each candidate has its own Studio and repo; nobody else has one", () => {
    const a = candidateMediaStudio("qwen35-9b");
    const b = candidateMediaStudio("gemma4-e4b");
    const c = candidateMediaStudio("minicpmo45");
    expect(new Set([a?.base, b?.base, c?.base]).size).toBe(3);
    expect(new Set([a?.repo, b?.repo, c?.repo]).size).toBe(3);
    expect(a?.base).toContain("sham-donor-qwen35-9b-media");
    for (const other of ["coder", "sham_v2", "sham", "", undefined, "../x"]) expect(candidateMediaStudio(other as string | undefined)).toBeNull();
  });
});

describe("computer tools under the zero-cost policy (production)", () => {
  const withEnv = (value: string, fn: () => void) => {
    const original = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = value;
    try { fn(); } finally { (process.env as Record<string, string | undefined>).NODE_ENV = original; }
  };
  test("a candidate's computer is the task Linux box: sandbox_* tools, no failing cloud_computer_* tools", () => {
    withEnv("production", () => {
      const all = names(["computer"]);
      expect(all).toEqual(expect.arrayContaining(["sandbox_clone", "sandbox_exec", "sandbox_search"]));
      expect(all.some((n) => n.startsWith("cloud_computer_"))).toBe(false);
    });
  });
});
