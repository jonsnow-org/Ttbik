import { parseCoderSse, recoverTextToolCalls, type CoderReply } from "@/lib/openCoderStudio";

const DSML = ' / <｜DSML｜function_calls>\n<｜DSML｜invoke name="web_search">\n<｜DSML｜parameter name="query" string="true">jonsnow-org/Ttbik GitHub repository</｜DSML｜parameter>\n<｜DSML｜parameter name="limit">5</｜DSML｜parameter>\n</｜DSML｜invoke>\n</｜DSML｜function_calls>';

describe("DSML tool calls written as text", () => {
  it("become real tool calls and leave the text clean", () => {
    const r = recoverTextToolCalls({ type: "done", text: "سأبحث." + DSML, finish_reason: "stop" } as CoderReply);
    expect(r.tool_calls).toHaveLength(1);
    expect(r.tool_calls![0].function.name).toBe("web_search");
    expect(JSON.parse(r.tool_calls![0].function.arguments)).toEqual({ query: "jonsnow-org/Ttbik GitHub repository", limit: 5 });
    expect(r.text).toBe("سأبحث. /");
    expect(r.finish_reason).toBe("tool_calls");
  });
  it("also reads the markup when the DSML prefix is missing on the parameter tags", () => {
    const t = '<｜DSML｜function_calls><｜DSML｜invoke name="x"><parameter name="a">1</parameter></｜DSML｜invoke></｜DSML｜function_calls>';
    const r = recoverTextToolCalls({ type: "done", text: t } as CoderReply);
    expect(r.tool_calls?.[0].function.name).toBe("x");
    expect(JSON.parse(r.tool_calls![0].function.arguments)).toEqual({ a: 1 });
  });
  it("leaves real tool calls, plain answers and unfinished jobs alone", () => {
    const real = { type: "done", text: "x" + DSML, tool_calls: [{ function: { name: "a", arguments: "{}" } }] } as CoderReply;
    expect(recoverTextToolCalls(real)).toBe(real);
    const plain = { type: "done", text: "مرحبا" } as CoderReply;
    expect(recoverTextToolCalls(plain)).toBe(plain);
    const pending = { type: "pending", text: DSML } as CoderReply;
    expect(recoverTextToolCalls(pending)).toBe(pending);
  });
  it("parseCoderSse applies it", () => {
    const body = "data: " + JSON.stringify([JSON.stringify({ type: "done", text: DSML })]) + "\n";
    expect(parseCoderSse(body)?.tool_calls?.[0].function.name).toBe("web_search");
  });
});
