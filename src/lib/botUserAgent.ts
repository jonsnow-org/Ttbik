// Which requests are machines, not people. Used by the page-view tracker so the visitor numbers the owner reads are real people:
// crawlers, link previews, uptime monitors and headless browsers (the repository's own Playwright/Chromium probes and promo
// recorders open the home page many times a day) are accepted quietly but never counted.
const MACHINE_UA =
  /bot|crawl|spider|slurp|facebookexternalhit|telegrambot|whatsapp|headless|lighthouse|pagespeed|gtmetrix|playwright|puppeteer|selenium|webdriver|phantomjs|python-|python\/|curl\/|wget|httpie|axios|node-fetch|undici|go-http|java\/|okhttp|libwww|uptime|monitor|pingdom|statuscake|preview|scanner|vercel|cloudflare-|insomnia|postman/i;

export function isMachineUserAgent(userAgent: string): boolean {
  const ua = String(userAgent || "").trim();
  if (!ua) return true; // real browsers always send one
  return MACHINE_UA.test(ua);
}

/** Conversion events share the page_views table: path "evt:<name>:<page>", so no new table or migration is needed. */
export function isEventPath(path: string): boolean {
  return /^evt:[a-z0-9_]{1,40}:/.test(path);
}
