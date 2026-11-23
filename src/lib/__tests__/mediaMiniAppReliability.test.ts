import fs from "fs";
import path from "path";

const root = path.join(__dirname, "..", "..", "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("media mini-app reliability regressions", () => {
  const page = () => read("src/app/mini-app/page.tsx");
  const feed = () => read("src/app/api/media-feed/route.ts");
  const botFeed = () => read("media-bot/services/feed.py");
  const comments = () => read("src/app/api/media-comments/route.ts");

  it("does not turn feed API failures into an empty feed or erase the last good page", () => {
    const source = page();
    expect(source).toContain('const [feedError, setFeedError] = useState("")');
    expect(source).toContain('const [loadMoreError, setLoadMoreError] = useState("")');
    expect(source).toMatch(/if \(!r\.ok\) throw new Error\(String\(j\.error \|\| `HTTP \$\{r\.status\}`\)\)/);
    expect(source).toContain('setFeedError(e instanceof Error ? e.message : "تعذّر تحميل الخلاصة")');
    expect(source).toContain("setLoadMoreError(e instanceof Error ? e.message : \"تعذّر تحميل المزيد\")");
    expect(source).not.toMatch(/catch \{ setItems\(\[\]\); setNextOffset\(null\); \}/);
    expect(source).toContain("تعذّر تحميل محتوى التطبيق");
    expect(source).toContain("تعذّر تحميل المزيد:");
  });

  it("tries the media stream fallback once and does not loop back to the failed route", () => {
    const source = page();
    expect(source).toContain("if (!viaVercel[id])");
    expect(source).toContain('setViaVercel((v) => ({ ...v, [id]: true }))');
    expect(source).toContain('تعذّر تشغيل المقطع عبر مساري البث');
    expect(source).toMatch(/const playItem = \(item: FeedItem\) => \{[\s\S]*?playErrorAttempts\.current\[item\.id\] = 0;[\s\S]*?setViaVercel\(\(v\) => \(\{ \.\.\.v, \[item\.id\]: false \}\)\)/);
  });

  it("handles rewarded-ad exceptions and always releases the busy state", () => {
    const source = page();
    expect(source).toContain("تعذّر تسجيل المكافأة الآن");
    expect(source).toMatch(/async function watchSupportAd\(\)[\s\S]*?catch \{[\s\S]*?تعذّر تسجيل المكافأة الآن[\s\S]*?\} finally \{[\s\S]*?setAdBusy\(false\)/);
  });

  it("preserves users' unsent text when Telegram permissions reject messages or comments", () => {
    const source = page();
    expect(source).toContain('if (r && r.status === 403) { setDmInput(body);');
    expect(source).toContain('if (r && r.status === 403) { setCommentInput(bodyText); setReplyTo(prevReply);');
  });

  it("only removes moderation targets after the server confirms the write", () => {
    const source = page();
    expect(source).toMatch(/async function hideItem\(id: string\)[\s\S]*?if \(!r\.ok \|\| !j\.ok\) throw[\s\S]*?setItems\(\(prev\) => prev\.filter/);
    expect(source).toMatch(/async function saveForceSub\(\)[\s\S]*?if \(!r\.ok \|\| !j\.ok\) throw/);
    expect(source).toMatch(/async function runBroadcast\(\)[\s\S]*?r\.ok && j\.ok/);
  });

  it("fails closed on a configured database outage and rejects non-persistent feed posts", () => {
    const source = feed();
    expect(source).toContain("databaseConfigured && fromDb === null");
    expect(source).toContain('status: 503');
    expect(source).toContain("persisted: false");
    expect(source).toContain('g.__mediaFeed = mapped');
    expect(source).toContain('squad_code,hidden');
  });

  it("rejects replies whose parent comment belongs to another post", () => {
    const source = comments();
    expect(source).toContain('.eq("id", parentId)');
    expect(source).toContain('.eq("post_id", postId)');
    expect(source).toContain("parent comment not found");
    expect(source).toContain("parentReplyTo");
  });

  it("keeps private-room access metadata on the bot's compatibility retry", () => {
    const source = botFeed();
    expect(source).toContain('"squad_code": item["squad_code"]');
    expect(source).toContain('data.get("persisted", True)');
  });
});
