const SITE = "https://ttbik.vercel.app";
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "qr-link", title: "شام AI: رمز QR لهذا الرابط", contexts: ["link", "page"] });
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "qr-link") return;
  const target = info.linkUrl || info.pageUrl || (tab && tab.url) || "";
  if (!/^https?:/.test(target)) return;
  chrome.tabs.create({ url: `${SITE}/free-tools/qr-generator?utm_source=chrome_extension&utm_medium=context_menu&text=${encodeURIComponent(target)}` });
});
