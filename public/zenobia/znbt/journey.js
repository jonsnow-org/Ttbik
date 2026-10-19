// Journey page: streak, rank, quests, invite link, top creators. Progress score only (see the note on the page).
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var tg = window.Telegram && window.Telegram.WebApp;
  var hap = function (k) { try { if (tg && tg.HapticFeedback) k === 'ok' ? tg.HapticFeedback.notificationOccurred('success') : tg.HapticFeedback.impactOccurred('light'); } catch (e) {} };
  var el = function (tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  var invited = 0;

  var QUESTS = [
    { id: 'wallet', t: 'Connect your wallet', pts: 30, href: '/zenobia/portfolio.html', cta: 'Connect', ok: function () { try { return !!localStorage.getItem('ton-connect-storage_bridge-connection'); } catch (e) { return false; } } },
    { id: 'watch3', t: 'Add 3 coins to your watchlist', pts: 30, href: '/zenobia/coins.html', cta: 'Explore', ok: function () { try { return JSON.parse(localStorage.getItem('znbt-watch-v1') || '[]').length >= 3; } catch (e) { return false; } } },
    { id: 'react', t: 'React to a coin (⭐ 🔥 💔)', pts: 20, href: '/zenobia/coins.html', cta: 'Open a coin', ok: function () { return !!ZJ.state().done.react; } },
    { id: 'alert', t: 'Turn on an alert for a coin', pts: 40, href: '/zenobia/coins.html', cta: 'Open a coin', ok: function () { return !!ZJ.state().done.alert; } },
    { id: 'swap', t: 'Make your first swap', pts: 100, href: '/zenobia/swap.html', cta: 'Swap', ok: function () { return !!ZJ.state().done.swap; } },
    { id: 'trade', t: 'Buy or sell a platform coin', pts: 100, href: '/zenobia/coins.html', cta: 'Trade', ok: function () { return !!ZJ.state().done.trade; } },
    { id: 'launch', t: 'Launch your own coin', pts: 200, href: '/zenobia/create.html', cta: 'Launch', ok: function () { return !!ZJ.state().done.launch; } },
    { id: 'invite', t: 'Invite a friend who joins', pts: 150, href: '#invite', cta: 'Invite', ok: function () { return invited >= 1; } },
    { id: 'channel', t: 'Join the Telegram channel', pts: 20, href: 'https://t.me/Zenobiaton', cta: 'Join', ext: true, ok: function () { return !!ZJ.state().done.channel; } }
  ];

  function hero() {
    var s = ZJ.state(), r = ZJ.rank(s.pts), st = ZJ.streak(), box = $('hero');
    box.textContent = '';
    var top = el('div', 'jrow');
    var left = el('div'); left.append(el('div', 'jrank', r.name), el('div', 'mut', s.pts + ' points'));
    var fire = el('div', 'jstreak'); fire.append(el('span', null, '🔥'), el('b', null, String(st)), el('span', 'mut', st === 1 ? 'day' : 'days'));
    top.append(left, fire); box.append(top);
    var bar = el('div', 'bar'); var fill = el('div'); var pct = r.next ? Math.min(100, ((s.pts - r.from) / (r.next[0] - r.from)) * 100) : 100; fill.style.width = pct + '%'; bar.append(fill);
    box.append(bar, el('div', 'mut', r.next ? (r.next[0] - s.pts) + ' points to ' + r.next[1] : 'Top rank reached'));
    var b = el('button', null, ZJ.checkedIn() ? '✓ Checked in today' : 'Daily check-in'); b.disabled = ZJ.checkedIn();
    b.onclick = function () { var g = ZJ.checkin(); if (g) { hap('ok'); b.textContent = '+' + g + ' points'; setTimeout(render, 900); } };
    b.style.marginTop = '12px'; box.append(b);
  }

  function quests() {
    var box = $('quests'); box.textContent = '';
    var s = ZJ.state();
    QUESTS.forEach(function (q) {
      var done = q.ok(), claimed = !!s.claimed[q.id];
      var c = el('div', 'card jq' + (claimed ? ' claimed' : ''));
      var info = el('div', 'jqi'); info.append(el('b', null, q.t), el('span', 'mut', '+' + q.pts + ' points'));
      c.append(info);
      var act;
      if (claimed) act = el('span', 'jdone', '✓');
      else if (done) { act = el('button', null, 'Claim'); act.onclick = function () { ZJ.claim(q.id, q.pts); hap('ok'); render(); }; }
      else { act = el('a', 'jgo', q.cta); act.href = q.href; if (q.ext) { act.target = '_blank'; act.rel = 'noopener'; act.onclick = function () { ZJ.done('channel'); }; } if (q.id === 'invite') act.onclick = function (e) { e.preventDefault(); $('invite').scrollIntoView({ behavior: 'smooth' }); }; }
      c.append(act); box.append(c);
    });
  }

  function inviteCard() {
    var box = $('invite'); box.textContent = '';
    if (!tg || !tg.initData) { box.append(el('div', 'mut', 'Open the platform from the Telegram bot to get your invite link.')); return; }
    fetch('/api/zenobia/ref', { headers: { 'x-tg-init': tg.initData } }).then(function (r) { return r.json(); }).then(function (j) {
      box.textContent = '';
      if (!j.link) { box.append(el('div', 'mut', 'Invite link is not available right now.')); return; }
      invited = j.invited || 0;
      box.append(el('div', null, 'Friends who joined with your link: ' + invited), el('div', 'mut', 'Invites are counted only. No payment is attached to them.'));
      var share = el('button', null, 'Share invite link'); share.style.marginTop = '10px';
      share.onclick = function () { var u = 'https://t.me/share/url?url=' + encodeURIComponent(j.link) + '&text=' + encodeURIComponent('Launch and trade coins on TON with Palmyra Launch'); if (tg.openTelegramLink) tg.openTelegramLink(u); else window.open(u, '_blank'); };
      var copy = el('button', 'alt', 'Copy link'); copy.style.marginTop = '8px';
      copy.onclick = function () { try { navigator.clipboard.writeText(j.link); copy.textContent = 'Copied ✓'; } catch (e) {} };
      box.append(share, copy); quests();
    }).catch(function () { box.append(el('div', 'mut', 'Could not load the invite link.')); });
  }

  function creators() {
    var box = $('creators');
    fetch('/api/zenobia/coins/index').then(function (r) { return r.json(); }).then(function (j) {
      var hidden = {}; (j.hidden || []).forEach(function (h) { hidden[h] = 1; });
      var by = {};
      (j.coins || []).forEach(function (c) { if (hidden[c.curve]) return; var a = by[c.creator] || (by[c.creator] = { creator: c.creator, n: 0, raised: 0 }); a.n++; a.raised += Number(BigInt(c.raisedNano || '0') / 1000000n) / 1000; });
      var list = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.raised - a.raised; }).slice(0, 5);
      box.textContent = '';
      if (!list.length) { box.append(el('div', 'mut', 'No coins yet. Launch the first one.')); return; }
      list.forEach(function (a, i) {
        var r = el('div', 'jl'); r.append(el('span', 'jn', String(i + 1)), el('span', null, a.creator.slice(0, 5) + '…' + a.creator.slice(-4)), el('span', 'mut', a.n + (a.n === 1 ? ' coin' : ' coins')), el('b', null, a.raised.toFixed(1) + ' GRAM raised'));
        box.append(r);
      });
      box.append(el('div', 'mut', 'Ranked by the amount raised on the curves, from public chain data.'));
    }).catch(function () { box.textContent = ''; box.append(el('div', 'mut', 'Could not load creators.')); });
  }

  function render() { hero(); quests(); }
  render(); inviteCard(); creators();
})();
