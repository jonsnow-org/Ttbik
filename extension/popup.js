const SITE = "https://ttbik.vercel.app";
const UTM = "utm_source=chrome_extension&utm_medium=popup";
const TOOLS = [
  ["🕌 مواقيت الصلاة", "/prayer-times"],
  ["🕋 حاسبة الزكاة", "/free-tools/zakat-calculator"],
  ["⚖️ مؤشر BMI", "/free-tools/bmi-calculator"],
  ["📅 هجري ↔ ميلادي", "/free-tools/hijri-converter"],
  ["🧾 ضريبة VAT", "/free-tools/vat-calculator"],
  ["📈 هامش الربح", "/free-tools/profit-margin"],
  ["💬 رابط واتساب", "/free-tools/whatsapp-link"],
  ["🖼️ ضغط الصور", "/free-tools/image-optimizer"],
  ["⏱️ عدّاد العمر", "/free-tools/life-counter"],
  ["🔗 اختصار الروابط", "/free-tools/url-shortener"],
];
const q = (path, extra = "") => `${SITE}${path}${path.includes("?") ? "&" : "?"}${UTM}${extra}`;

const box = document.getElementById("tools");
for (const [label, path] of TOOLS) {
  const a = document.createElement("a");
  a.textContent = label;
  a.href = q(path);
  a.target = "_blank";
  box.appendChild(a);
}
document.getElementById("all").href = q("/#free-tools");

async function currentUrl() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab && tab.url && /^https?:/.test(tab.url) ? tab.url : "";
}
document.getElementById("qr-page").addEventListener("click", async () => {
  const url = await currentUrl();
  chrome.tabs.create({ url: q("/free-tools/qr-generator", url ? `&text=${encodeURIComponent(url)}` : "") });
});
document.getElementById("short-page").addEventListener("click", async () => {
  const url = await currentUrl();
  chrome.tabs.create({ url: q("/free-tools/url-shortener", url ? `&url=${encodeURIComponent(url)}` : "") });
});
