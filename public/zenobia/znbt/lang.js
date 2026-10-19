// Palmyra Launch pages are English by default. The Arabic text that sits next to it ("English · العربية") is hidden
// unless the visitor chose Arabic (the small language button, or ?lang=ar). Russian (?lang=ru) translates the English text with
// the dictionary in lang-ru.js. Runs on text added later by the page scripts too.
(function () {
  var AR = /[؀-ۿ]/, RUN = /[؀-ۿ][؀-ۿ\s،؟؛!.:\-]*/g;
  var q = null, saved = null;
  var OK = { ar: 1, en: 1, ru: 1 };
  try { q = new URLSearchParams(location.search).get("lang"); if (OK[q]) localStorage.setItem("znbtLang", q); saved = localStorage.getItem("znbtLang"); } catch (e) {}
  var lang = OK[q] ? q : OK[saved] ? saved : "en";
  document.documentElement.lang = lang;
  var D = null;
  if (lang === "ru") { try { document.write('<script src="/zenobia/znbt/lang-ru.js"><\/script>'); } catch (e) {} }
  function tr1(t) {
    if (!D) D = window.ZNBT_RU || null;
    if (!D) return t;
    if (D.exact.hasOwnProperty(t)) return D.exact[t];
    for (var i = 0; i < D.rx.length; i++) { var m = D.rx[i][0].exec(t); if (m) return typeof D.rx[i][1] === "function" ? D.rx[i][1](m) : t.replace(D.rx[i][0], D.rx[i][1]); }
    return t;
  }
  function tr(s) {
    var lead = (/^\s*/.exec(s) || [""])[0], trail = (/\s*$/.exec(s) || [""])[0], t = s.trim();
    if (!t || !/[A-Za-z]/.test(t)) return s;
    var r = tr1(t);
    if (r === t && t.indexOf(" · ") > 0) { var parts = t.split(" · "), ch = false; parts = parts.map(function (x) { var y = tr1(x); if (y !== x) ch = true; return y; }); if (ch) r = parts.join(" · "); }
    return r === t ? s : lead + r + trail;
  }
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
      if (lang === "ru") c = tr(c);
      if (c !== v) {
        node.nodeValue = c;
        if (c === "" && p.nodeType === 1 && p.children.length === 0 && p.textContent === "" && p.id !== "result") p.style.display = "none";
      }
    } else if (node.nodeType === 1) {
      if (/^(SCRIPT|STYLE)$/.test(node.nodeName)) return;
      ["placeholder", "title", "aria-label"].forEach(function (a) { var x = node.getAttribute(a); if (x && (AR.test(x) || lang === "ru")) { var y = clean(x); if (lang === "ru") y = tr(y); if (y !== x) node.setAttribute(a, y); } });
      for (var i = 0; i < node.childNodes.length; i++) fix(node.childNodes[i]);
    }
  }
  function run() { fix(document.documentElement); if (AR.test(document.title) || lang === "ru") { var t = clean(document.title); if (lang === "ru") t = t.replace(/^([^·]*?)(\s*·\s*)/, function (m0, a, b) { return tr(a) + b; }); document.title = t; } }
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
    var NEXT = { en: "Русский", ru: "العربية", ar: "English" };
    var label = NEXT[lang];
    if (b) { if (txt) txt.textContent = label; }
    else if (!/[?&]rec=1/.test(location.search)) { b = document.createElement("a"); b.href = "#"; b.textContent = label; b.style.cssText = "position:fixed;top:10px;right:10px;z-index:9;font:12px system-ui,sans-serif;padding:4px 10px;border-radius:999px;background:rgba(0,0,0,.55);color:#fff;text-decoration:none"; document.body.appendChild(b); }
    if (b) b.onclick = function (e) { e.preventDefault(); try { localStorage.setItem("znbtLang", { en: "ru", ru: "ar", ar: "en" }[lang]); } catch (x) {} location.reload(); };
  });
})();
