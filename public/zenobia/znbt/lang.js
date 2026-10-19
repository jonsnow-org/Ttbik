// Palmyra Launch shows ONE language at a time: English (default), Russian or Arabic. Chosen in the top bar (nav.js) or with ?lang=en|ru|ar.
// The page markup carries English plus an Arabic side ("English · العربية"). en keeps the English side; ar keeps the Arabic side;
// ru keeps the English side and translates it with lang-ru.js. English-only texts are translated in ru and ar by their dictionaries.
// Anything a dictionary does not know stays English (never blank). Runs on text added later by the page scripts too.
(function () {
  var AR = /[؀-ۿ]/, RUN = /[؀-ۿ][؀-ۿ\s،؟؛!.:\-]*/g;
  var OK = { ar: 1, en: 1, ru: 1 }, q = null, saved = null;
  try { q = new URLSearchParams(location.search).get("lang"); if (OK[q]) localStorage.setItem("znbtLang", q); saved = localStorage.getItem("znbtLang"); } catch (e) {}
  var lang = OK[q] ? q : OK[saved] ? saved : "en";
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  var D = null;
  if (lang !== "en") { try { document.write('<script src="/zenobia/znbt/lang-' + lang + '.js"><\/script>'); } catch (e) {} }
  function cleanEn(s) {
    if (!AR.test(s)) return s;
    var out = s.replace(RUN, "").replace(/\s*·\s*(?=\()/g, " ").replace(/(\s*·\s*){2,}/g, " · ").replace(/^\s*·\s*|\s*·\s*$/g, "").replace(/[ \t]{2,}/g, " ");
    return out.trim() === "" ? "" : out;
  }
  // "English · العربية" / "English / العربية": keep only the segments that contain Arabic
  function pickAr(s) {
    if (!AR.test(s)) return s;
    var segs = s.split(/\s·\s|\s\/\s/), keep = segs.filter(function (x) { return AR.test(x); });
    return keep.length && keep.length < segs.length ? keep.join(" · ").trim() : s;
  }
  function tr1(t) {
    if (!D) D = window["ZNBT_" + lang.toUpperCase()] || null;
    if (!D) return t;
    if (D.exact.hasOwnProperty(t)) return D.exact[t];
    for (var i = 0; i < D.rx.length; i++) { var m = D.rx[i][0].exec(t); if (m) return typeof D.rx[i][1] === "function" ? D.rx[i][1](m) : t.replace(D.rx[i][0], D.rx[i][1]); }
    return t;
  }
  function tr(s) {
    var lead = (/^\s*/.exec(s) || [""])[0], trail = (/\s*$/.exec(s) || [""])[0], t = s.trim();
    if (!t || !/[A-Za-z]{2,}/.test(t)) return s;
    var r = tr1(t);
    if (r === t && t.indexOf(" · ") > 0) { var parts = t.split(" · "), ch = false; parts = parts.map(function (x) { var y = tr1(x); if (y !== x) ch = true; return y; }); if (ch) r = parts.join(" · "); }
    return r === t ? s : lead + r + trail;
  }
  function conv(v) {
    if (lang === "ar") {
      var en = cleanEn(v), t = tr(en);          // a full Arabic translation from the dictionary beats the short Arabic hint in the markup
      return t !== en ? t : tr(pickAr(v));
    }
    var c = cleanEn(v);
    if (lang !== "en") c = tr(c);
    return c;
  }
  function fix(node) {
    if (node.nodeType === 3) {
      var p = node.parentNode;
      if (!p || /^(SCRIPT|STYLE)$/.test(p.nodeName) || (p.closest && p.closest("[data-keep]"))) return;
      var v = node.nodeValue, c = conv(v);
      if (c !== v) {
        node.nodeValue = c;
        if (c === "" && p.nodeType === 1 && p.children.length === 0 && p.textContent === "" && p.id !== "result") p.style.display = "none";
      }
    } else if (node.nodeType === 1) {
      if (/^(SCRIPT|STYLE)$/.test(node.nodeName) || (node.hasAttribute && node.hasAttribute("data-keep"))) return;
      ["placeholder", "title", "aria-label"].forEach(function (a) { var x = node.getAttribute(a); if (x && /[A-Za-z؀-ۿ]/.test(x)) { var y = conv(x); if (y !== x) node.setAttribute(a, y); } });
      for (var i = 0; i < node.childNodes.length; i++) fix(node.childNodes[i]);
    }
  }
  function title() {
    var t = document.title; if (!/[A-Za-z؀-ۿ]/.test(t)) return;
    var parts = t.split(/\s·\s/);
    document.title = parts.map(function (x) { return conv(x); }).filter(function (x) { return x; }).join(" · ");
  }
  function run() { fix(document.documentElement); title(); }
  new MutationObserver(function (ms) {
    ms.forEach(function (m) {
      if (m.type === "characterData") fix(m.target);
      else m.addedNodes.forEach(fix);
    });
  }).observe(document.documentElement, { childList: true, characterData: true, subtree: true });
  document.addEventListener("DOMContentLoaded", function () {
    run();
    // pages without the app shell (the Caravan Hall, the Silk Road passport) keep a small floating language button
    if (!document.querySelector(".top") && !/[?&]rec=1/.test(location.search)) {
      var NEXT = { en: ["ru", "Русский"], ru: ["ar", "العربية"], ar: ["en", "English"] };
      var b = document.createElement("a"); b.href = "#"; b.setAttribute("data-keep", ""); b.textContent = NEXT[lang][1];
      b.style.cssText = "position:fixed;top:10px;right:10px;z-index:9;font:12px system-ui,sans-serif;padding:6px 10px;border-radius:999px;background:#000a;color:#fff;border:1px solid #fff3;text-decoration:none";
      b.onclick = function (e) { e.preventDefault(); try { localStorage.setItem("znbtLang", NEXT[lang][0]); } catch (x) {} var u = new URL(location.href); u.searchParams.set("lang", NEXT[lang][0]); location.href = u.toString(); };
      document.body.appendChild(b);
    }
  });
})();
