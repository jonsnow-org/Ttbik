import { fastStudioBases, filterByTier, tierFor } from "@/lib/coderTier";
import type { CoderMessage } from "@/lib/openCoderStudio";

const FAST = fastStudioBases("https://fast-4.example/, https://fast-5.example");
const user = (content: string): CoderMessage[] => [{ role: "system", content: "s" }, { role: "user", content }];

describe("difficulty tier routing", () => {
  it("does nothing when no fast Studio is configured", () => {
    expect(tierFor(user("مرحبا"), [], new Set())).toBeUndefined();
    const order = [{ b: "a" }, { b: "b" }];
    expect(filterByTier(order, "fast", new Set())).toBe(order);
  });
  it("a greeting goes to the fast model", () => {
    expect(tierFor(user("مرحبا"), [], FAST)).toBe("fast");
  });
  it("code, agent and long requests go to the strong model", () => {
    expect(tierFor(user("اقرأ المستودع jonsnow-org/Ttbik وحلل الأخطاء"), [], FAST)).toBe("strong");
    expect(tierFor(user("اكتب دالة python تفرز القائمة\n```python\ndef f(x):\n  pass\n```"), [], FAST)).toBe("strong");
    expect(tierFor(user("a".repeat(900)), [], FAST)).toBe("strong");
  });
  it("a tool step, a picture or many tools stay on the strong model", () => {
    expect(tierFor([...user("مرحبا"), { role: "assistant", content: "", tool_calls: [] }, { role: "tool", content: "x" }], [], FAST)).toBe("strong");
    expect(tierFor([{ role: "user", content: "مرحبا", images: ["data:image/png;base64,AA"] }], [], FAST)).toBe("strong");
    expect(tierFor(user("مرحبا"), Array.from({ length: 9 }, () => ({ type: "function", function: { name: "t", description: "", parameters: {} } })) as never, FAST)).toBe("strong");
  });
  it("filters Studios by tier and never leaves a request without a Studio", () => {
    const order = [{ b: "https://fast-4.example" }, { b: "https://slow-1.example" }, { b: "https://slow-2.example" }];
    expect(filterByTier(order, "fast", FAST).map((x) => x.b)).toEqual(["https://fast-4.example"]);
    expect(filterByTier(order, "strong", FAST).map((x) => x.b)).toEqual(["https://slow-1.example", "https://slow-2.example"]);
    const onlySlow = [{ b: "https://slow-1.example" }];
    expect(filterByTier(onlySlow, "fast", FAST)).toBe(onlySlow);
  });
});
