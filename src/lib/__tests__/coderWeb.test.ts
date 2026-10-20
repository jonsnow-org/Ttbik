import { checkUrl, decodeEntities, deepResearch, fetchPage, formatResearch, htmlToMarkdown, parseBing, parseBrave, parseDdg, passages, planQueries, privateIp, relevance, resetSearchHealth, safeGet, searchHealth, webSearch, parseDdgLite, parseSearx } from "@/lib/coderWeb";

beforeEach(() => resetSearchHealth());
import { runTool } from "@/lib/coderAgent";

const PUBLIC = async () => ["93.184.216.34"];
const b64 = (s: string) => Buffer.from(s).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

const BRAVE = `<div data-type="web" data-pos="0"><a href="https://nextjs.org/docs/app/api-reference/functions/after" class="l1"><div class="title search-snippet-title" title="after - Next.js">after</div></a><div class="generic-snippet"><div class="content t-primary">September 16, 2026 - after <strong>allows you to schedule work</strong> after a response.</div></div></div>
<div data-type="web" data-pos="1"><a href="https://dev.to/x/nextjs-after"><div class="search-snippet-title" title="Next.js after() explained">x</div></a><div class="generic-snippet"><div class="content">Using after in Next.js &amp; logging</div></div></div>`;
const BING = `<ol><li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&amp;p=1&amp;u=a1${b64("https://nextjs.org/docs/app/api-reference/functions/after")}&amp;ntb=1">after - <strong>Next.js</strong></a></h2><div class="b_caption"><p class="b_lineclamp2">Sep 16, 2026 · API Reference for the after function in Next.js</p></div></li>
<li class="b_algo"><h2><a href="https://tutorialspoint.com/nextjs/after.htm">Next.js after function</a></h2><div class="b_caption"><p>The Next.js after function schedules work</p></div></li></ol>`;
const ddg = (url: string, title: string, snip: string) => `<div class="result results_links results_links_deep web-result"><a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(url)}&amp;rut=x">${title}</a><a class="result__snippet" href="#">${snip}</a></div>`;
const DDG = ddg("https://react.dev/reference/react/use", "use – React", "use is a React API that lets you read the value of a resource");
const JUNK_BING = `<li class="b_algo"><h2><a href="https://www.next.co.uk/">Next Official Site: Fashion</a></h2><p class="b_lineclamp2">Shop clothes</p></li><li class="b_algo"><h2><a href="https://www.next.us/">Next US</a></h2><p class="b_lineclamp2">Shop online</p></li>`;

function router(routes: Record<string, (url: string) => Response | Promise<Response>>) {
  const calls: string[] = [];
  const f = jest.fn(async (url: string) => {
    calls.push(url);
    for (const [k, fn] of Object.entries(routes)) if (url.includes(k)) return fn(url);
    return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const html = (body: string, status = 200, headers: Record<string, string> = {}) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", ...headers } });

describe("address safety", () => {
  it("knows private, loopback, link-local, CGNAT, metadata and IPv6 local ranges", () => {
    for (const ip of ["10.1.2.3", "127.0.0.1", "169.254.169.254", "172.20.0.1", "192.168.1.1", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "198.18.0.1"]) expect(privateIp(ip)).toBe(true);
    for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700::1111"]) expect(privateIp(ip)).toBe(false);
  });
  it("refuses dark-web, local, credentialed, non-http and privately-resolving URLs", async () => {
    expect((await checkUrl("http://abcdefghijklmnop.onion/", PUBLIC)).ok).toBe(false);
    expect((await checkUrl("http://site.i2p/", PUBLIC)).ok).toBe(false);
    expect((await checkUrl("http://localhost:3000/", PUBLIC)).ok).toBe(false);
    expect((await checkUrl("http://metadata.google.internal/", PUBLIC)).ok).toBe(false);
    expect((await checkUrl("https://user:pw@example.com/", PUBLIC)).ok).toBe(false);
    expect((await checkUrl("file:///etc/passwd", PUBLIC)).ok).toBe(false);
    expect((await checkUrl("http://169.254.169.254/latest/meta-data", PUBLIC)).ok).toBe(false);
    expect((await checkUrl("https://evil.example/", async () => ["10.0.0.5"])).ok).toBe(false);
    expect((await checkUrl("https://example.com/a", PUBLIC)).ok).toBe(true);
  });
  it("re-checks every redirect hop", async () => {
    const { f } = router({ "https://example.com/start": () => new Response("", { status: 302, headers: { location: "http://127.0.0.1/admin" } }) });
    await expect(safeGet("https://example.com/start", { fetchImpl: f, resolve: PUBLIC })).rejects.toThrow(/local|private/);
  });
  it("follows safe redirects", async () => {
    const { f } = router({ "https://example.com/start": () => new Response("", { status: 301, headers: { location: "/final" } }), "https://example.com/final": () => html("<p>ok</p>") });
    const r = await safeGet("https://example.com/start", { fetchImpl: f, resolve: PUBLIC });
    expect(r.url).toBe("https://example.com/final");
    expect(r.body).toContain("ok");
  });
});

describe("search result parsing", () => {
  it("parses Brave, Bing (decoding its redirect links) and DuckDuckGo", () => {
    const br = parseBrave(BRAVE);
    expect(br[0]).toMatchObject({ title: "after - Next.js", url: "https://nextjs.org/docs/app/api-reference/functions/after", source: "brave" });
    expect(br[0].snippet).toBe("after allows you to schedule work after a response.");
    expect(br[1].snippet).toContain("&");
    const bi = parseBing(BING);
    expect(bi[0].url).toBe("https://nextjs.org/docs/app/api-reference/functions/after");
    expect(bi[0].title).toBe("after - Next.js");
    expect(bi[1].snippet).toContain("schedules work");
    const dd = parseDdg(DDG);
    expect(dd[0]).toMatchObject({ url: "https://react.dev/reference/react/use", title: "use – React" });
  });
  it("scores whether a result list is about the query", () => {
    expect(relevance("next.js after function", parseBing(BING))).toBeGreaterThan(0.9);
    expect(relevance("next.js after function", parseBing(JUNK_BING))).toBeLessThan(0.3);
  });
  it("merges providers, drops an off-topic list and de-duplicates", async () => {
    const { f } = router({
      "search.brave.com": () => html("rate limited", 429),
      "bing.com/search": () => html(JUNK_BING),
      "duckduckgo.com/html": () => html(ddg("https://nextjs.org/docs/app/api-reference/functions/after", "after – Next.js function", "the next.js after function") + ddg("https://nextjs.org/docs/app/api-reference/functions/after#x", "dup", "next.js after function")),
      "wikipedia.org": () => new Response(JSON.stringify({ query: { search: [{ title: "Next.js", snippet: "framework" }] } }), { headers: { "content-type": "application/json" } }),
    });
    const r = await webSearch("next.js after function", { fetchImpl: f, resolve: PUBLIC });
    expect(r.hits.some((h) => /next\.co\.uk/.test(h.url))).toBe(false);
    expect(r.hits[0].url).toBe("https://nextjs.org/docs/app/api-reference/functions/after");
    expect(r.tried.join(" ")).toMatch(/brave:429/);
    expect(new Set(r.hits.map((h) => h.url)).size).toBe(r.hits.length);
  });
  it("never throws when every engine fails", async () => {
    const { f } = router({});
    const r = await webSearch("anything at all", { fetchImpl: (async () => { throw new Error("offline"); }) as any, resolve: PUBLIC });
    expect(r.hits).toEqual([]);
    expect(r.tried.length).toBeGreaterThan(2);
    void f;
  });
});

describe("page reading", () => {
  const PAGE = `<html><head><title>Guide &amp; Notes</title><link rel="stylesheet" media="(min-width: 40rem)" href="x.css"><style>p{}</style></head><body>
    <nav><a href="/">Home</a> <a href="/docs">Docs</a></nav>
    <main><h1>Install</h1><p>Run the <code>npm ci</code> command to install packages exactly as locked.</p>
    <pre><code class="language-sh">npm ci
npm test &amp;&amp; echo ok</code></pre>
    <ul><li>First item with a <a href="/more">link</a></li><li>Second</li></ul>
    <table><tr><th>Key</th><th>Value</th></tr><tr><td>a</td><td>1</td></tr></table></main>
    <footer>Copyright</footer><script>alert(1)</script></body></html>`;
  it("extracts the main content as Markdown with code fences, lists, links and tables", () => {
    const { title, markdown } = htmlToMarkdown(PAGE, "https://example.com/guide");
    expect(title).toBe("Guide & Notes");
    expect(markdown).toContain("# Install");
    expect(markdown).toContain("`npm ci`");
    expect(markdown).toContain("```\nnpm ci\nnpm test && echo ok\n```");
    expect(markdown).toContain("[link](https://example.com/more)");
    expect(markdown).toMatch(/\| Key \| Value \|/);
    expect(markdown).not.toMatch(/alert|Copyright|Home|stylesheet|40rem/);
  });
  it("returns raw text for JSON / plain files and refuses binaries", async () => {
    const { f } = router({
      "https://example.com/a.json": () => new Response('{"a":1}', { headers: { "content-type": "application/json" } }),
      "https://example.com/a.pdf": () => new Response("%PDF", { headers: { "content-type": "application/pdf" } }),
      "https://example.com/missing": () => html("no", 404),
    });
    expect((await fetchPage("https://example.com/a.json", { fetchImpl: f, resolve: PUBLIC })).markdown).toBe('{"a":1}');
    expect((await fetchPage("https://example.com/a.pdf", { fetchImpl: f, resolve: PUBLIC })).error).toMatch(/unsupported/);
    expect((await fetchPage("https://example.com/missing", { fetchImpl: f, resolve: PUBLIC })).error).toBe("HTTP 404");
    expect((await fetchPage("http://x.onion/", { fetchImpl: f, resolve: PUBLIC })).error).toMatch(/dark-web/);
  });
  it("decodes entities", () => {
    expect(decodeEntities("&lt;a&gt; &amp; &#39;x&#39; &#x2713; &nbsp;")).toBe("<a> & 'x' ✓  ");
  });
});

describe("deep research", () => {
  it("plans several query variants (or uses the model's own)", () => {
    const q = planQueries("How do I cache fetch results in Next.js app router?", [], new Date("2026-10-21T00:00:00Z"));
    expect(q.length).toBeGreaterThanOrEqual(4);
    expect(q.some((x) => x.includes("2026"))).toBe(true);
    expect(planQueries("x", ["a", "b", "a"])).toEqual(["a", "b"]);
  });
  it("ranks paragraphs by the question's terms and skips link lists and markup", () => {
    const md = "Intro about cats and other unrelated things in a long paragraph here.\n\n[a](x) [b](y) [c](z) [d](w) [e](v) [f](u)\n\nTo cache fetch results in Next.js use the cache option and revalidate settings on each request call.\n\nrel=\"stylesheet\" data-x=\"1\" fetch cache next.js nonsense markup line here";
    const p = passages(md, ["cache", "fetch", "next.js"]);
    expect(p[0].text).toMatch(/^To cache fetch/);
    expect(p.some((x) => /rel=/.test(x.text))).toBe(false);
  });
  it("searches in parallel, reads many sources, cites them and shows corroboration", async () => {
    const pages: Record<string, string> = {
      "https://docs.example.com/cache": "<main><h1>Caching</h1><p>Next.js fetch requests can be cached with the cache option; revalidate sets how long a cached fetch lives.</p></main>",
      "https://blog.example.org/next-cache": "<article><p>In Next.js the fetch cache is controlled per request; use revalidate for time-based caching of fetch.</p></article>",
      "https://forum.example.net/t/1": "<main><p>Unrelated chatter about holidays.</p></main>",
    };
    const results = `<li class="b_algo"><h2><a href="https://docs.example.com/cache">Caching fetch in Next.js</a></h2><p class="b_lineclamp2">Next.js fetch cache revalidate</p></li>
      <li class="b_algo"><h2><a href="https://blog.example.org/next-cache">Next.js fetch cache guide</a></h2><p class="b_lineclamp2">cache fetch next.js</p></li>
      <li class="b_algo"><h2><a href="https://forum.example.net/t/1">Next.js fetch cache question</a></h2><p class="b_lineclamp2">fetch cache</p></li>
      <li class="b_algo"><h2><a href="https://example.com/">Next.js fetch cache home</a></h2><p class="b_lineclamp2">next.js fetch cache</p></li>`;
    const { f, calls } = router({
      "bing.com/search": () => html(results),
      "search.brave.com": () => html("", 429),
      "duckduckgo.com": () => html("", 202),
      ...Object.fromEntries(Object.entries(pages).map(([u, b]) => [u, () => html(b)])),
      "https://example.com/": () => html("<main><p>home page</p></main>"),
    });
    const r = await deepResearch("How does Next.js cache fetch results with revalidate?", { fetchImpl: f, resolve: PUBLIC, deadlineMs: 20000 });
    expect(r.queries.length).toBeGreaterThanOrEqual(4);
    expect(calls.filter((c) => c.includes("bing.com/search")).length).toBe(r.queries.length);
    const ok = r.sources.filter((s) => s.ok).map((s) => s.url);
    expect(ok).toEqual(expect.arrayContaining(["https://docs.example.com/cache", "https://blog.example.org/next-cache"]));
    expect(r.sources[r.sources.length - 1].url).toBe("https://example.com/");      // a bare home page ranks last
    expect(r.corroborated.find((c) => c.term === "revalidate")?.sources.length).toBeGreaterThanOrEqual(2);
    const text = formatResearch(r);
    expect(text).toMatch(/\[1\] .+ — https:\/\//);
    expect(text).toMatch(/Cite every claim as \[n\]/);
  }, 30000);
  it("is reachable as agent tools (web_search, fetch_page, deep_research) and web_fetch is now guarded too", async () => {
    const ctx = { gh: null, addNote: () => undefined, fetchImpl: (async () => html("<main><p>hello world from the page body text</p></main>")) as any };
    expect(await runTool({ id: "1", type: "function", function: { name: "web_fetch", arguments: JSON.stringify({ url: "http://127.0.0.1/" }) } }, ctx)).toMatch(/^error: could not read/);
    expect(await runTool({ id: "2", type: "function", function: { name: "web_search", arguments: "{}" } }, ctx)).toMatch(/query is required/);
    expect(await runTool({ id: "3", type: "function", function: { name: "deep_research", arguments: "{}" } }, ctx)).toMatch(/question is required/);
  });
});

describe("search failover", () => {
  const html = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/html" } });
  it("rests an engine after two failures, uses the backups when the primaries leave too little, and reports health", async () => {
    const calls: string[] = [];
    const lite = `<table><tr><td><a rel="nofollow" href="//duckduckgo.com/l/?uddg=${encodeURIComponent("https://vitejs.dev/guide/")}" class='result-link'>Vite guide config</a></td></tr><tr><td class='result-snippet'>Vite guide: config options for vite</td></tr></table>`;
    const f = (async (u: any) => {
      const url = String(u);
      calls.push(url);
      if (url.includes("lite.duckduckgo.com")) return html(lite);
      if (url.includes("searx.example")) return new Response(JSON.stringify({ results: [{ url: "https://vitejs.dev/config/", title: "Vite config", content: "vite config reference" }] }), { status: 200, headers: { "content-type": "application/json" } });
      return html("blocked", 429);
    }) as typeof fetch;
    process.env.CODER_SEARXNG_URLS = "https://searx.example";
    for (let i = 0; i < 2; i++) {
      const r = await webSearch("vite config guide", { fetchImpl: f, resolve: PUBLIC });
      expect(r.hits.map((h) => h.url)).toEqual(expect.arrayContaining(["https://vitejs.dev/guide/", "https://vitejs.dev/config/"]));
    }
    const h = searchHealth();
    expect(h.filter((x) => x.tier === "primary").every((x) => !x.ok)).toBe(true);
    expect(h.find((x) => x.name === "duckduckgo-lite")!.ok).toBe(true);
    calls.length = 0;
    await webSearch("vite config guide", { fetchImpl: f, resolve: PUBLIC });
    expect(calls.some((c) => c.includes("bing.com"))).toBe(false);                            // resting primaries are skipped
    expect(calls.some((c) => c.includes("lite.duckduckgo.com"))).toBe(true);
    delete process.env.CODER_SEARXNG_URLS;
  });
  it("parses the backup engines", () => {
    expect(parseSearx("not json")).toEqual([]);
    expect(parseDdgLite("<html></html>")).toEqual([]);
  });
});
