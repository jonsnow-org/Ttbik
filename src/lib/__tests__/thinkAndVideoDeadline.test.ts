import { stripThinkTags } from "@/lib/coderSections";
import { videoDeadlineMs, videoJobCapMs } from "@/lib/novaMedia";

describe("a thought block never reaches the chat (live 2026-11-04: a small model greeted with <think></think>)", () => {
  it("drops empty and full thought blocks", () => {
    expect(stripThinkTags("<think></think>\n<think></think>\nمرحبا! كيف يمكنني مساعدتك؟")).toBe("مرحبا! كيف يمكنني مساعدتك؟");
    expect(stripThinkTags("<think>plan</think>الجواب")).toBe("الجواب");
  });
  it("holds back an unclosed block at the tail; plain text is untouched", () => {
    expect(stripThinkTags("أهلاً <think>still writing")).toBe("أهلاً ");
    expect(stripThinkTags("نص عادي")).toBe("نص عادي");
  });
});

describe("video deadline follows the number of 4 s passes", () => {
  it("gives a 6 s clip (two passes) more than the old 300 s, and a 2 min clip under the 2 h cap", () => {
    expect(videoDeadlineMs(6)).toBeGreaterThan(500000);
    expect(videoDeadlineMs(120)).toBeLessThan(7200000);
  });
  it("the bot's poll ceiling never cuts a long clip short (a fixed 40 min aborted a 60 s clip)", () => {
    expect(videoJobCapMs(6)).toBeGreaterThanOrEqual(40 * 60000);           // short clips keep the floor
    expect(videoJobCapMs(60)).toBeGreaterThan(40 * 60000);                 // 60 s needs ~55 min of passes: above the old fixed cap
    expect(videoJobCapMs(60)).toBeGreaterThan(videoDeadlineMs(60));        // and above the Studio's own budget (slack for delivery)
    expect(videoJobCapMs(120)).toBeLessThanOrEqual(2 * 3600_000);          // never above the 2 h ceiling
  });
});

import { withModelIdentity, modelDisplayName } from "@/lib/coderSections";
import { NOVA_LITE_SYSTEM } from "@/lib/modes";
import { coderSystemPrompt } from "@/lib/coderAgent";
import { dropMediaClaims } from "@/lib/coderMediaFast";
import { parseShamReply } from "@/lib/shamStudio";

describe("each model knows who it is and what it can do (live 2026-11-04: a small model answered «من انت» with the repo name, 'I can't make images')", () => {
  it("Nova stays Nova AI and gets the same capabilities line; the text is the same every call (prompt cache)", () => {
    const a = withModelIdentity(NOVA_LITE_SYSTEM, "coder");
    expect(a).toMatch(/I'm Nova AI/);
    expect(a).toMatch(/CAN make pictures/);
    expect(withModelIdentity(NOVA_LITE_SYSTEM, "coder")).toBe(a);
  });
});

describe("greeting never gets a 'no file' note (live 2026-11-04 5:07 AM)", () => {
  it("a reply that was only a false claim, with no media asked for, becomes a normal question back", () => {
    expect(dropMediaClaims("ها هي الصورة.", false)).toBe("كيف يمكنني مساعدتك؟");
  });
});

describe("Sham v2's empty thought never shows", () => {
  it("parseShamReply strips <think></think> from text", () => {
    expect(parseShamReply(JSON.stringify({ type: "text", text: "<think></think>\nأهلاً" }))?.text).toBe("أهلاً");
  });
});
