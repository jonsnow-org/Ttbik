import { brandSelfReferences } from "@/lib/coderIdentity";

describe("SHAM AI self-references", () => {
  it("rewrites the model naming itself or its maker", () => {
    expect(brandSelfReferences("أهلاً! أنا **Coder**، مساعد برمجي.")).toBe("أهلاً! أنا **SHAM AI**، مساعد برمجي.");
    expect(brandSelfReferences("أنا Qwen، تم تطويري من قبل Alibaba Cloud.")).toBe("أنا SHAM AI، تم تطويري من قبل شام (Sham).");
    expect(brandSelfReferences("I am Qwen, a large language model developed by Alibaba Cloud.")).toBe("I am SHAM AI, a large language model developed by Sham.");
    expect(brandSelfReferences("I'm a language model called Qwen3.5-4B")).toBe("I'm SHAM AI");
  });
  it("never touches code or unrelated mentions", () => {
    const code = "```py\n# I am Qwen developed by Alibaba Cloud\nmodel = 'Qwen/Qwen2.5'\n```";
    expect(brandSelfReferences(code)).toBe(code);
    expect(brandSelfReferences("استخدم `I am Qwen` كنص تجريبي")).toBe("استخدم `I am Qwen` كنص تجريبي");
    expect(brandSelfReferences("مكتبة Qwen من Alibaba مفيدة لمشروعك.")).toBe("مكتبة Qwen من Alibaba مفيدة لمشروعك.");
  });
});
