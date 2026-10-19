// The app shell shared by the platform pages: language dropdown + menu in the top bar, and the bottom bar
// (Explore, Watchlist, Launch in the middle, Swap, Portfolio). Information pages and the language live in the top bar, not in the tabs.
(function () {
  var p = location.pathname, qs = location.search;
  if (/[?&]rec=1/.test(qs)) return;   // screen recordings for videos: no shell
  var I = {
    home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    rocket: '<path d="M12 3c3 2 5 5 5 9l-2 3H9l-2-3c0-4 2-7 5-9z"/><path d="M9 15l-3 4 4-1M15 15l3 4-4-1"/><circle cx="12" cy="10" r="1.4"/>',
    swap: '<path d="M7 7h13M16 3l4 4-4 4M17 17H4M8 13l-4 4 4 4"/>',
    wallet: '<path d="M4 7a2 2 0 0 1 2-2h12v4"/><path d="M4 7v10a2 2 0 0 0 2 2h14V9H6a2 2 0 0 1-2-2z"/><path d="M16 14h2"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
    dots: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>'
  };
  var svg = function (k) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + I[k] + '</svg>'; };
  var LANGS = [['en', 'English'], ['ru', 'Русский'], ['ar', 'العربية']];
  var cur = 'en';
  try { var q = new URLSearchParams(qs).get('lang'); cur = /^(en|ru|ar)$/.test(q) ? q : (localStorage.getItem('znbtLang') || 'en'); } catch (e) {}
  if (!/^(en|ru|ar)$/.test(cur)) cur = 'en';
  var watch = /[?&]tab=watch/.test(qs);
  var tabs = [
    ['/zenobia/coins.html', 'home', 'Explore', function () { return /coins\.html|trade\.html/.test(p) && !watch; }],
    ['/zenobia/coins.html?tab=watch', 'star', 'Watchlist', function () { return /coins\.html/.test(p) && watch; }],
    ['/zenobia/create.html', 'rocket', 'Launch', function () { return /create\.html|launch\.html/.test(p); }, true],
    ['/zenobia/swap.html', 'swap', 'Swap', function () { return /swap\.html/.test(p); }],
    ['/zenobia/portfolio.html', 'wallet', 'Portfolio', function () { return /portfolio\.html|earnings\.html/.test(p); }]
  ];
  function close() { document.querySelectorAll('.ddm').forEach(function (m) { m.remove(); }); document.querySelectorAll('.ibtn.on').forEach(function (b) { b.classList.remove('on'); }); }
  function dropdown(btn, items) {
    var wrap = document.createElement('div'); wrap.className = 'dd'; wrap.appendChild(btn);
    btn.onclick = function (e) {
      e.stopPropagation();
      var open = wrap.querySelector('.ddm'); close(); if (open) return;
      btn.classList.add('on');
      var m = document.createElement('div'); m.className = 'ddm'; m.setAttribute('role', 'menu');
      items(m); wrap.appendChild(m);
    };
    return wrap;
  }
  function build() {
    var top = document.querySelector('.top');
    var brand = document.querySelector('.brand');
    if (brand) brand.childNodes.forEach(function (n) { if (n.nodeType === 3 && n.nodeValue.trim()) { var sp = document.createElement('span'); sp.className = 'bn'; sp.textContent = n.nodeValue; brand.replaceChild(sp, n); } });
    if (top) {
      var lb = document.createElement('button'); lb.type = 'button'; lb.className = 'ibtn'; lb.setAttribute('aria-label', 'Language');
      lb.setAttribute('data-keep', ''); lb.innerHTML = svg('globe').replace('<svg', '<svg width="16" height="16" style="stroke:currentColor;fill:none;stroke-width:1.8;margin-inline-end:5px"') + cur.toUpperCase();
      top.appendChild(dropdown(lb, function (m) {
        LANGS.forEach(function (l) {
          var a = document.createElement('button'); a.type = 'button'; a.setAttribute('data-keep', '');
          a.innerHTML = '<span>' + l[1] + '</span>' + (l[0] === cur ? '<span class="chk2">✓</span>' : '');
          a.onclick = function () { try { localStorage.setItem('znbtLang', l[0]); } catch (e) {} var u = new URL(location.href); u.searchParams.set('lang', l[0]); location.href = u.toString(); };
          m.appendChild(a);
        });
      }));
      var mb = document.createElement('button'); mb.type = 'button'; mb.className = 'ibtn'; mb.setAttribute('aria-label', 'Menu'); mb.innerHTML = svg('dots').replace('<svg', '<svg width="20" height="20" style="fill:currentColor"');
      top.appendChild(dropdown(mb, function (m) {
        [['Terms & risks', '/zenobia/terms.html', ''], ['Telegram channel', 'https://t.me/Zenobiaton', '↗'], ['Telegram bot', 'https://t.me/PalmyraLaunchBot', '↗']].forEach(function (x) {
          var a = document.createElement('a'); a.href = x[1]; if (x[2]) { a.target = '_blank'; a.rel = 'noopener'; }
          a.innerHTML = '<span>' + x[0] + '</span><span class="mut">' + x[2] + '</span>'; m.appendChild(a);
        });
      }));
    }
    var nav = document.createElement('nav'); nav.className = 'tabbar'; nav.setAttribute('aria-label', 'Main');
    tabs.forEach(function (t) {
      var a = document.createElement('a'); a.href = t[0];
      var on = t[3](); if (on) { a.className = 'on'; a.setAttribute('aria-current', 'page'); }
      if (t[4]) { a.className += ' fab'; a.innerHTML = '<i>' + svg(t[1]) + '</i>' + t[2]; }
      else a.innerHTML = svg(t[1]) + t[2];
      nav.appendChild(a);
    });
    document.body.appendChild(nav);
    document.addEventListener('click', close);
    // Telegram: the system back button (and the header arrow) must go back inside the app, not minimise it.
    // Explore is the home page, so back there leaves the app as usual; everywhere else it is shown and handled here.
    try {
      var tg = window.Telegram && window.Telegram.WebApp;
      if (tg) {
        try { tg.ready(); tg.expand(); tg.setHeaderColor('#06060b'); tg.setBackgroundColor('#06060b'); } catch (e) {}
        var home = /coins\.html/.test(p) && !watch;
        var bb = tg.BackButton;
        if (bb && !home) {
          bb.show();
          bb.onClick(function () {
            var open = Array.prototype.find.call(document.querySelectorAll('.sheet'), function (s) { return s.style.display !== 'none'; });
            if (open) { var sc = document.getElementById('scrim'); if (sc) sc.click(); return; }
            if (document.querySelector('.ddm')) { close(); return; }
            if (history.length > 1) history.back(); else location.href = '/zenobia/coins.html';
          });
        } else if (bb) bb.hide();
      }
    } catch (e) {}
    var onScroll = function () { var t = document.querySelector('.top'); if (t) t.classList.toggle('scrolled', window.scrollY > 6); };
    window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
