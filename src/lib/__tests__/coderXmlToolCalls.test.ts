import { rescueXmlToolCalls } from "../coderXmlToolCalls";

describe("rescueXmlToolCalls", () => {
  test("turns the XML tool call text into a structured call and strips it", () => {
    const r = rescueXmlToolCalls("Got it.\n<tool_call>\n<function=computer_repo>\n<parameter=url>\nhttps://github.com/jonsnow-org/Ttbik\n</parameter>\n</function>\n</tool_call>");
    expect(r.text).toBe("Got it.");
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].function.name).toBe("computer_repo");
    expect(JSON.parse(r.calls[0].function.arguments)).toEqual({ url: "https://github.com/jonsnow-org/Ttbik" });
  });
  test("keeps numbers and several parameters; plain text is untouched", () => {
    const r = rescueXmlToolCalls("<tool_call><function=computer_read><parameter=path>a.py</parameter><parameter=limit>40</parameter></function></tool_call>");
    expect(JSON.parse(r.calls[0].function.arguments)).toEqual({ path: "a.py", limit: 40 });
    expect(rescueXmlToolCalls("no call here")).toEqual({ text: "no call here", calls: [] });
  });

  test("a call cut before its closing tags still runs, and the raw markup is removed", () => {
    const r = rescueXmlToolCalls("وجدت المشكلة.\n\n<tool_call>\n<function=computer_search>\n<parameter=pattern>\ndaily|chain\n</parameter>\n<parameter=path>\nrepos/jonsnow-org-Ttbik\n</parameter>\n</");
    expect(r.calls).toHaveLength(1);
    expect(JSON.parse(r.calls[0].function.arguments)).toEqual({ pattern: "daily|chain", path: "repos/jonsnow-org-Ttbik" });
    expect(r.text).toBe("وجدت المشكلة.");
  });
  test("two calls, the first cut mid-closer: both found; a half-written parameter is never run", () => {
    const r = rescueXmlToolCalls("<tool_call>\n<function=computer_read>\n<parameter=path>\na.py\n</parameter>\n</function\n\n<tool_call>\n<function=computer_write>\n<parameter=path>\nb.py\n</parameter>\n<parameter=content>\nhalf wri");
    expect(r.calls.map((c) => c.function.name)).toEqual(["computer_read"]);
    expect(r.text).not.toMatch(/tool_call|function=|parameter=/);
  });
});
