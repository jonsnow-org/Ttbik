import * as N from "@/lib/coderThreads";
import { searchConversations } from "@/lib/coderMemory";
import { runTool } from "@/lib/coderAgent";
import { pgDb } from "./pgDb";

// Nova's self-analysis (2026-11-24): "I do not keep the context of earlier conversations". conversation_search reads the user's OWN earlier Nova chats.
describe("conversation_search: earlier conversations, ranked by words and meaning", () => {
  const db: any = pgDb();
  const OWNER = 770001;
  beforeEach(async () => {               // pgDb empties every table before each test
    process.env.CODER_TOKEN_KEY = process.env.CODER_TOKEN_KEY || "test-key";
    await N.createThread(OWNER, { title: "إعداد الخادم", messages: [{ role: "user", content: "نشرنا البوت على خادم أوراكل أمس" }, { role: "assistant", content: "تم، الخادم يعمل" }] as any }, db);
    await N.createThread(OWNER, { title: "Recipes", messages: [{ role: "user", content: "how do I cook rice" }, { role: "assistant", content: "boil water first" }] as any }, db);
    await N.createThread(770002, { title: "other user", messages: [{ role: "user", content: "secret deploy server for someone else" }] as any }, db);
  });
  it("an English query finds the Arabic chat about the server, with title", async () => {
    const out = await searchConversations(OWNER, "which server did we deploy to?", 3, db);
    expect(out).toMatch(/إعداد الخادم/);
    expect(out).toMatch(/أوراكل/);
    expect(out).not.toMatch(/someone else/);          // never another user's chats
  });
  it("nothing matches → says so", async () => {
    expect(await searchConversations(OWNER, "quantum chromodynamics", 3, db)).toMatch(/nothing/);
  });
  it("the tool respects the user's recall switch", async () => {
    const call = { id: "1", type: "function", function: { name: "conversation_search", arguments: JSON.stringify({ query: "server" }) } } as any;
    expect(await runTool(call, { gh: null, addNote: () => {}, userId: OWNER, memoryChatId: OWNER, db, memory: { remember: true, recall: false } } as any)).toMatch(/switched off/);
    expect(await runTool(call, { gh: null, addNote: () => {}, userId: OWNER, memoryChatId: OWNER, db } as any)).toMatch(/أوراكل/);
  });
});
