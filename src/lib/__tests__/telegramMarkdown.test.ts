import { markdownToTelegramHtml, stripMarkdown } from "@/lib/telegramMarkdown";

describe("model Markdown for Telegram", () => {
  it("headings, bold, lists, inline code and links become Telegram HTML", () => {
    const html = markdownToTelegramHtml("### **من أنا؟**\nأنا **SHAM AI** و`x < y`\n* بند\n[موقع](https://a.example/x?a=1&b=2)");
    expect(html).toBe('<b>من أنا؟</b>\nأنا <b>SHAM AI</b> و<code>x &lt; y</code>\n• بند\n<a href="https://a.example/x?a=1&amp;b=2">موقع</a>');
  });
  it("code blocks are literal and an unclosed fence is closed", () => {
    expect(markdownToTelegramHtml("```js\nconst a = **b** < 1;\n```")).toBe('<pre><code class="language-js">const a = **b** &lt; 1;</code></pre>');
    expect(markdownToTelegramHtml("```\nx")).toBe("<pre>x</pre>");
  });
  it("plain fallback drops the marks", () => {
    expect(stripMarkdown("## عنوان\n**قوي** و`c`")).toBe("عنوان\nقوي وc");
  });
});
