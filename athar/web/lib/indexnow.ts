// IndexNow (https://www.indexnow.org): tell the search engines that support it (Bing, Yandex, Seznam, Naver...) which of our pages exist or changed,
// so they are found without waiting for a crawl. No account is needed: the key below is public and also served as /<key>.txt (public/).
import { SITE_URL } from "./config";

export const INDEXNOW_KEY = "abc3744f31fa29714cbadf320e310e22";
let last = 0;

/** Sent at most once every 12 hours per server run, and only from the real https site (never from a development machine). */
export async function submitIndexNow(urls: string[]): Promise<void> {
  if (!/^https:\/\/[^/]+/.test(SITE_URL) || /localhost/.test(SITE_URL) || Date.now() - last < 12 * 3600 * 1000 || urls.length === 0) return;
  last = Date.now();
  try {
    await fetch("https://api.indexnow.org/indexnow", {
      method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ host: new URL(SITE_URL).host, key: INDEXNOW_KEY, keyLocation: `${SITE_URL}/${INDEXNOW_KEY}.txt`, urlList: urls.slice(0, 10000) }),
    });
  } catch { /* the search engines can be asked again in 12 hours */ }
}
