// One quiet Adsterra banner (320x50) on the public coin list only (never on pages where a wallet signs or money moves).
// Same rule as src/lib/adsterraKeys.ts: the gate's own unit on the gate's address, the original unit elsewhere.
(function () {
  var box = document.getElementById('ad');
  if (!box) return;
  var key = location.hostname === 'ttbik-gate.jonsnowx1r.workers.dev' ? '8f7c8d3dde15b92944741daff182a498' : '560a1eb1632771185b888243a7d36a07';
  var f = document.createElement('iframe');
  f.width = 320; f.height = 50; f.title = 'ad'; f.style.cssText = 'border:0;display:block;margin:12px auto';
  f.setAttribute('scrolling', 'no');
  f.srcdoc = '<!DOCTYPE html><html><head><style>html,body{margin:0;overflow:hidden}</style></head><body><script>atOptions={"key":"' + key + '","format":"iframe","height":50,"width":320,"params":{}};<\/script><script src="https://www.highrevenueformat.com/' + key + '/invoke.js"><\/script></body></html>';
  box.appendChild(f);
})();
