// IndexNow lets Bing, Yandex, Seznam and others learn about new/changed URLs
// immediately instead of waiting weeks for a crawl (Bing also feeds ChatGPT
// search and Copilot). The key is public by design: it only proves we own the
// host, via the key file served at /indexnow-key.txt.
export const INDEXNOW_KEY = process.env.INDEXNOW_KEY || "7f3b1c9e5a2d4e8f9b6c0a1d3e5f7a92";
