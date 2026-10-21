import { callRepo, decide, globalPolicy, nextPolicy, pickRule, tierDefault, type PrefRule } from "@/lib/coderPrefs";
import { describeCron, nextRun, parseCron, toCron } from "@/lib/coderCron";

const R = (category: any, policy: any, repo = "*", context: any = "*"): PrefRule => ({ category, policy, repo, context });

describe("confirmation policy", () => {
  it("defaults to the tier: users ask for everything, the owner only for deletes and main/default writes", () => {
    expect(decide(["settings"], "user", "o/r", "interactive", []).action).toBe("ask");
    expect(decide(["settings"], "owner", "o/r", "interactive", []).action).toBe("run");
    expect(decide(["delete"], "owner", "o/r", "interactive", []).action).toBe("ask");
    expect(decide([], "user", "o/r", "interactive", []).action).toBe("run");
  });
  it("auto-allow lets it through (and reports it for the history); also for the owner's deletes / main pushes", () => {
    const d = decide(["delete", "push_default"], "owner", "o/r", "interactive", [R("delete", "allow"), R("main", "allow")]);
    expect(d.action).toBe("run");
    expect(d.autoAllowed).toEqual(["delete", "push_default"]);
  });
  it("auto-deny wins over everything else in the same call", () => {
    const d = decide(["delete", "push_default"], "owner", "o/r", "interactive", [R("delete", "allow"), R("main", "deny")]);
    expect(d.action).toBe("deny");
    expect(d.denied).toEqual(["push_default"]);
  });
  it("an explicit 'ask' makes the owner tier ask too", () => {
    expect(decide(["release_publish"], "owner", "o/r", "interactive", [R("release", "ask")]).action).toBe("ask");
  });
  it("the most specific rule wins: repo beats context beats global", () => {
    const rules = [R("deploy", "deny"), R("deploy", "ask", "*", "scheduled"), R("deploy", "allow", "o/site")];
    expect(pickRule(rules, "deploy", "x/y", "interactive")?.policy).toBe("deny");
    expect(pickRule(rules, "deploy", "x/y", "scheduled")?.policy).toBe("ask");
    expect(pickRule(rules, "deploy", "O/Site", "scheduled")?.policy).toBe("allow");
    expect(decide(["workflow_deploy"], "user", "o/site", "interactive", rules).action).toBe("run");
  });
  it("'allow for the rest of this task' covers only its categories", () => {
    expect(decide(["delete"], "user", "o/r", "interactive", [], ["delete"]).action).toBe("run");
    expect(decide(["delete", "settings"], "user", "o/r", "interactive", [], ["delete"]).ask).toEqual(["settings"]);
  });
  it("finds the repo of a call (args or REST path) and cycles policies", () => {
    expect(callRepo({ id: "1", type: "function", function: { name: "github_delete_branch", arguments: '{"repo":"Org/Repo"}' } })).toBe("org/repo");
    expect(callRepo({ id: "1", type: "function", function: { name: "github_api", arguments: '{"path":"/repos/a/b/hooks"}' } })).toBe("a/b");
    expect(["default", "ask", "allow", "deny"].map((p) => nextPolicy(p as any))).toEqual(["ask", "allow", "deny", "default"]);
    expect(globalPolicy([R("force", "deny")], "force")).toBe("deny");
    expect(globalPolicy([], "force")).toBe("default");
    expect(tierDefault("owner", "force")).toBe("run");
    expect(tierDefault("user", "force")).toBe("ask");
  });
});

describe("cron in the user's time zone", () => {
  it("parses fields, lists, ranges and steps; rejects bad input", () => {
    const c = parseCron("*/15 9-17 * * 1-5");
    expect([...c.min.set]).toEqual([0, 15, 30, 45]);
    expect(c.hour.set.has(17)).toBe(true);
    expect(c.dow.set.has(0)).toBe(false);
    expect(parseCron("0 0 * * 7").dow.set.has(0)).toBe(true);
    for (const bad of ["* * * *", "60 * * * *", "* 24 * * *", "a b c d e", "*/0 * * * *"]) expect(() => parseCron(bad)).toThrow();
  });
  it("computes the next run in the zone (Istanbul is UTC+3)", () => {
    const from = new Date("2026-10-21T05:00:00Z");                     // 08:00 in Istanbul
    expect(nextRun("0 9 * * *", "Europe/Istanbul", from)!.toISOString()).toBe("2026-10-21T06:00:00.000Z");
    expect(nextRun("0 9 * * *", "UTC", from)!.toISOString()).toBe("2026-10-21T09:00:00.000Z");
    expect(nextRun("30 8 * * 1-5", "Europe/Istanbul", new Date("2026-10-23T06:00:00Z"))!.toISOString()).toBe("2026-10-26T05:30:00.000Z");   // Fri after → Mon
  });
  it("handles daylight-saving changes by wall-clock time", () => {
    // Berlin leaves DST on 2026-10-25: 09:00 local is 07:00Z before and 08:00Z after
    expect(nextRun("0 9 * * *", "Europe/Berlin", new Date("2026-10-24T08:00:00Z"))!.toISOString()).toBe("2026-10-25T08:00:00.000Z");
    expect(nextRun("0 9 * * *", "Europe/Berlin", new Date("2026-10-23T08:00:00Z"))!.toISOString()).toBe("2026-10-24T07:00:00.000Z");
  });
  it("day-of-month OR day-of-week when both are set; impossible dates give null", () => {
    expect(nextRun("0 0 13 * 5", "UTC", new Date("2026-11-01T00:00:00Z"))!.toISOString()).toBe("2026-11-06T00:00:00.000Z");   // Friday comes first
    expect(nextRun("0 0 31 2 *", "UTC", new Date("2026-01-01T00:00:00Z"))).toBeNull();
  });
  it("friendly forms compile to cron and describe themselves", () => {
    expect(toCron("daily 09:00")).toBe("0 9 * * *");
    expect(toCron("weekdays 8:30")).toBe("30 8 * * 1-5");
    expect(toCron("weekly mon,thu 18:05")).toBe("5 18 * * 1,4");
    expect(toCron("weekly الخميس 18:00")).toBe("0 18 * * 4");
    expect(toCron("monthly 1 07:00")).toBe("0 7 1 * *");
    expect(toCron("hourly :15")).toBe("15 * * * *");
    expect(toCron('cron "0 6 * * 0"')).toBe("0 6 * * 0");
    expect(() => toCron("daily 25:00")).toThrow();
    expect(describeCron("0 9 * * *", "en")).toBe("Daily 09:00");
    expect(describeCron("5 18 * * 1,4", "ar")).toBe("أسبوعياً الاثنين، الخميس 18:05");
  });
});
