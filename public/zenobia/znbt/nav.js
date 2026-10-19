// The app shell shared by the platform pages: language dropdown + menu in the top bar, and the bottom bar
// (Explore, Watchlist, Launch in the middle, Swap, Portfolio). Information pages and the language live in the top bar, not in the tabs.

// Journey: a daily streak and one-time quests that earn points. Points are a progress score only: they are not money, not a token and promise nothing.
// They live on this device (so they can be reset by clearing the browser); invites are counted by the server.
window.ZJ = (function () {
  var KEY = 'znbt-journey-v1';
  var RANKS = [[0, 'Traveler'], [150, 'Caravaneer'], [400, 'Merchant'], [900, 'Governor'], [1800, 'Queen of the desert']];
  var day = function (d) { d = d || new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); };
  var load = function () { try { var j = JSON.parse(localStorage.getItem(KEY) || '{}'); return { pts: +j.pts || 0, days: j.days || [], done: j.done || {}, claimed: j.claimed || {} }; } catch (e) { return { pts: 0, days: [], done: {}, claimed: {} }; } };
  var save = function (s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} };
  var streak = function (s) {
    var n = 0, d = new Date(); var set = {}; s.days.forEach(function (x) { set[x] = 1; });
    if (!set[day(d)]) d.setDate(d.getDate() - 1);
    while (set[day(d)]) { n++; d.setDate(d.getDate() - 1); }
    return n;
  };
  return {
    state: load, day: day, streak: function () { return streak(load()); }, ranks: RANKS,
    rank: function (pts) { var r = RANKS[0], nx = null; for (var i = 0; i < RANKS.length; i++) { if (pts >= RANKS[i][0]) { r = RANKS[i]; nx = RANKS[i + 1] || null; } } return { name: r[1], from: r[0], next: nx }; },
    done: function (k) { var s = load(); if (!s.done[k]) { s.done[k] = 1; save(s); } },
    checkedIn: function () { return load().days.indexOf(day()) >= 0; },
    checkin: function () { var s = load(); if (s.days.indexOf(day()) >= 0) return 0; s.days.push(day()); s.days = s.days.slice(-120); var gain = 10 + Math.min(streak(s), 7) * 5; s.pts += gain; save(s); return gain; },
    claim: function (id, pts) { var s = load(); if (s.claimed[id]) return 0; s.claimed[id] = 1; s.pts += pts; save(s); return pts; }
  };
})();
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
        [['Journey & rewards', '/zenobia/journey.html', ''], ['Terms & risks', '/zenobia/terms.html', ''], ['Telegram channel', 'https://t.me/Zenobiaton', '↗'], ['Telegram bot', 'https://t.me/PalmyraLaunchBot', '↗']].forEach(function (x) {
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
        // Back never collapses the app by itself: it asks first (also covers the Android system back).
        var bb = tg.BackButton;
        var ask = { en: ['Leave the app?', 'Leave'], ru: ['Выйти из приложения?', 'Выйти'], ar: ['هل تريد الخروج من التطبيق؟', 'خروج'] }[cur] || ['Leave the app?', 'Leave'];
        try { if (tg.enableClosingConfirmation) tg.enableClosingConfirmation(); } catch (e) {}
        if (bb) {
          bb.show();
          bb.onClick(function () {
            if (tg.showConfirm) tg.showConfirm(ask[0], function (ok) { if (ok) tg.close(); });
            else if (confirm(ask[0])) tg.close();
          });
        }
      }
    } catch (e) {}
    // Native feel: light haptics on taps, and the next page is fetched before it is opened (the shell itself stays put during the transition).
    var hap = function () { try { var t = window.Telegram && window.Telegram.WebApp; if (t && t.HapticFeedback) t.HapticFeedback.impactOccurred('light'); } catch (e) {} };
    document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('button,.chip,.tabbar a,a.coin,a.mini,.tabs button')) hap(); }, true);
    var pre = {};
    var prefetch = function (a) {
      try { var u = new URL(a.href, location.href); if (u.origin !== location.origin || !/^\/zenobia\//.test(u.pathname) || pre[u.href] || /[?&]rec=1/.test(u.search)) return;
        pre[u.href] = 1; var l = document.createElement('link'); l.rel = 'prefetch'; l.href = u.href; document.head.appendChild(l); } catch (e) {}
    };
    document.addEventListener('touchstart', function (e) { var a = e.target.closest && e.target.closest('a[href]'); if (a) prefetch(a); }, { passive: true });
    document.addEventListener('mouseover', function (e) { var a = e.target.closest && e.target.closest('a[href]'); if (a) prefetch(a); });
    window.setTimeout(function () { document.querySelectorAll('.tabbar a').forEach(prefetch); }, 1200);
    // Pull down at the top of a page to refresh it.
    (function () {
      var y0 = null, ind = null, pulled = 0;
      var blocked = function (t) { return t.closest && t.closest('input,textarea,select,.sheet,.ddm,#chartBox,.strip,.chips'); };
      document.addEventListener('touchstart', function (e) { y0 = (window.scrollY <= 0 && !blocked(e.target)) ? e.touches[0].clientY : null; pulled = 0; }, { passive: true });
      document.addEventListener('touchmove', function (e) {
        if (y0 === null) return;
        pulled = e.touches[0].clientY - y0;
        if (pulled < 12 || window.scrollY > 0) { if (ind) ind.style.opacity = 0; return; }
        if (!ind) { ind = document.createElement('div'); ind.className = 'ptr'; ind.textContent = '↻'; document.body.appendChild(ind); }
        var k = Math.min(1, pulled / 90); ind.style.opacity = k; ind.style.transform = 'translate(-50%,' + Math.min(pulled, 110) * 0.6 + 'px) rotate(' + pulled * 3 + 'deg)'; ind.classList.toggle('go', pulled > 90);
      }, { passive: true });
      document.addEventListener('touchend', function () {
        if (y0 !== null && pulled > 90) { hap(); location.reload(); }
        if (ind) { ind.remove(); ind = null; } y0 = null; pulled = 0;
      }, { passive: true });
    })();
    var onScroll = function () { var t = document.querySelector('.top'); if (t) t.classList.toggle('scrolled', window.scrollY > 6); };
    window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
