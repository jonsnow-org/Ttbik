import { hideToolMarkup } from "@/lib/coderXmlToolCalls";

describe("hideToolMarkup", () => {
  it("leaves plain text alone", () => { expect(hideToolMarkup("مرحبا <b> ok ")).toBe("مرحبا <b> ok "); });
  it("hides a whole call", () => { expect(hideToolMarkup("سأبدأ\n<tool_call>\n<function=delegate>\n<parameter=title>x</parameter>")).toBe("سأبدأ"); });
  it("hides a call with no leading text", () => { expect(hideToolMarkup("<tool_call>")).toBe(""); });
  it("hides a cut-off opener", () => { expect(hideToolMarkup("نعم <tool_c")).toBe("نعم"); expect(hideToolMarkup("a <func")).toBe("a"); });
  it("keeps an unrelated trailing <", () => { expect(hideToolMarkup("x < y <b")).toBe("x < y <b"); });
});
