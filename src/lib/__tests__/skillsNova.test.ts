import { novaSkillText, NOVA_SKILL_NAMES } from "../skillsNova";

describe("Nova self-test skill", () => {
  const skill = novaSkillText("self_test");

  it("discovers real tools and reuses an existing checkout instead of looping", () => {
    expect(skill).toContain("inspect the actual load_tools enum");
    expect(skill).toContain("reuse the exact returned path");
    expect(skill).toContain("successful no-op, not a failure");
    expect(skill).toContain("Never guess a path");
    expect(skill).toContain("poll the returned id");
  });

  it("does not mutate a user's real memory or consume media quota during an audit", () => {
    expect(skill).toContain("Do NOT save or delete a marker in the user's real memory");
    expect(skill).toContain("Do not call make_media during a self-test");
    expect(skill).toContain("fake-database tests");
  });

  it("tests actual abilities and reports evidence rather than promising universal ability", () => {
    for (const term of ["computer_tools", "github_whoami", "web_search", "fetch_page", "memory_search", "view_image", "view_video", "NOVA_TLDM", "generate_tldm", "connector", "verified/conditional/unavailable/not tested"]) {
      expect(skill).toContain(term);
    }
    expect(NOVA_SKILL_NAMES).toContain("self_test");
  });
});
