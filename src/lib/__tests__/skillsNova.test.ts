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
    for (const term of ["computer_tools", "github_whoami", "web_search", "fetch_page", "memory_search", "view_image", "view_video", "NOVA_TLDM", "generate_tldm", "connector", "delegate", "schedule_list", "computer_bank", "NOT a financial bank account", "verified/conditional/unavailable/not tested"]) {
      expect(skill).toContain(term);
    }
    expect(NOVA_SKILL_NAMES).toContain("self_test");
  });
});

describe("Nova self-improvement skill", () => {
  const skill = novaSkillText("self_improve");

  it("defines an evidence-driven loop and model isolation", () => {
    for (const term of ["bounded, evidence-driven improvement loop", "OWN code", "coder or nova2", "implemented/configured/connected/verified/blocked/not tested", "feature branch", "regression tests"]) {
      expect(skill).toContain(term);
    }
    expect(skill).toContain("Never modify Sham");
  });

  it("requires real connections and protects credentials and external data", () => {
    for (const term of ["connector_api", "request_secret", "hosted secret vault", "never ask for secrets in chat", "harmless read-only call", "paid resources"]) {
      expect(skill).toContain(term);
    }
  });

  it("preserves approvals, resource limits and CI gates", () => {
    for (const term of ["Never weaken authentication", "owner approves", "wait for all required CI checks", "branch protection", "production deployment", "do not loop"]) {
      expect(skill).toContain(term);
    }
    expect(NOVA_SKILL_NAMES).toContain("self_improve");
  });
});
