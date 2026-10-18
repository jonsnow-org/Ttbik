// Palmyra Launch pages are English by default. The Arabic text that sits next to it ("English · العربية") is hidden
// unless the visitor chose Arabic (the small language button, or ?lang=ar). Runs on text added later by the page scripts too.
(function () {
  var AR = /[؀-ۿ]/, RUN = /[؀-ۿ][؀-ۿ\s،؟؛!.:\-]*/g;
  var q = null, saved = null;
  try { q = new URLSearchParams(location.search).get("lang"); if (q === "ar" || q === "en") localStorage.setItem("znbtLang", q); saved = localStorage.getItem("znbtLang"); } catch (e) {}
  var lang = (q === "ar" || q === "en" ? q : saved) === "ar" ? "ar" : "en";
  document.documentElement.lang = lang;
  function clean(s) {
    if (!AR.test(s)) return s;
    var out = s.replace(RUN, "").replace(/\s*·\s*(?=\()/g, " ").replace(/(\s*·\s*){2,}/g, " · ").replace(/^\s*·\s*|\s*·\s*$/g, "").replace(/[ \t]{2,}/g, " ");
    return out.trim() === "" ? "" : out;
  }
  function fix(node) {
    if (lang === "ar") return;
    if (node.nodeType === 3) {
      var p = node.parentNode;
      if (!p || /^(SCRIPT|STYLE)$/.test(p.nodeName) || (p.closest && p.closest("[data-keep]"))) return;
      var v = node.nodeValue, c = clean(v);
      if (c !== v) {
        node.nodeValue = c;
        if (c === "" && p.nodeType === 1 && p.children.length === 0 && p.textContent === "" && p.id !== "result") p.style.display = "none";
      }
    } else if (node.nodeType === 1) {
      if (/^(SCRIPT|STYLE)$/.test(node.nodeName)) return;
      ["placeholder", "title", "aria-label"].forEach(function (a) { var x = node.getAttribute(a); if (x && AR.test(x)) node.setAttribute(a, clean(x)); });
      for (var i = 0; i < node.childNodes.length; i++) fix(node.childNodes[i]);
    }
  }
  function run() { fix(document.documentElement); if (AR.test(document.title)) document.title = clean(document.title); }
  new MutationObserver(function (ms) {
    ms.forEach(function (m) {
      if (m.type === "characterData") fix(m.target);
      else m.addedNodes.forEach(fix);
    });
  }).observe(document.documentElement, { childList: true, characterData: true, subtree: true });
  document.addEventListener("DOMContentLoaded", function () {
    run();
    var b = document.getElementById("langBtn");   // the tab bar's language item (nav.js); a small floating button when a page has no tab bar
    var txt = document.getElementById("langTxt");
    var label = lang === "en" ? "العربية" : "English";
    if (b) { if (txt) txt.textContent = label; }
    else if (!/[?&]rec=1/.test(location.search)) { b = document.createElement("a"); b.href = "#"; b.textContent = label; b.style.cssText = "position:fixed;top:10px;right:10px;z-index:9;font:12px system-ui,sans-serif;padding:4px 10px;border-radius:999px;background:rgba(0,0,0,.55);color:#fff;text-decoration:none"; document.body.appendChild(b); }
    if (b) b.onclick = function (e) { e.preventDefault(); try { localStorage.setItem("znbtLang", lang === "en" ? "ar" : "en"); } catch (x) {} location.reload(); };
  });
})();
