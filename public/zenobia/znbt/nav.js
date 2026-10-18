// The bottom tab bar shared by the platform pages (Explore, Launch, Info, language).
(function () {
  var p = location.pathname;
  var tabs = [
    ['/zenobia/coins.html', '🏠', 'Explore'],
    ['/zenobia/create.html', '🚀', 'Launch'],
    ['/zenobia/terms.html', 'ℹ️', 'Info'],
  ];
  function build() {
    var nav = document.createElement('nav');
    nav.className = 'tabbar';
    tabs.forEach(function (t) {
      var a = document.createElement('a');
      a.href = t[0];
      if (p === t[0] || (t[0].indexOf('coins') > 0 && p.indexOf('trade.html') > 0)) a.className = 'on';
      a.innerHTML = '<b>' + t[1] + '</b>' + t[2];
      nav.appendChild(a);
    });
    var l = document.createElement('a');
    l.href = '#'; l.id = 'langBtn'; l.innerHTML = '<b>🌐</b><span id="langTxt" data-keep>…</span>';
    nav.appendChild(l);
    document.body.appendChild(nav);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
