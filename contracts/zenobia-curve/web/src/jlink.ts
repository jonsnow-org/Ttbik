import { TonConnectUI } from '@tonconnect/ui';

// Journey page: link your wallet to your Telegram account (TonConnect ton_proof). Needed so invite rewards can be credited to the right person.
const initData = (): string => (window as any).Telegram?.WebApp?.initData || '';
const ui = new TonConnectUI({ manifestUrl: location.origin + '/zenobia/tonconnect-manifest.json', actionsConfiguration: { twaReturnUrl: 'https://t.me/PalmyraLaunchBot' as `${string}://${string}` } });

(window as any).ZLink = async (): Promise<string> => {
  const hdr = { 'content-type': 'application/json', 'x-tg-init': initData() };
  const c = await (await fetch('/api/zenobia/ref/link/challenge', { method: 'POST', headers: hdr })).json();
  if (!c.payload) throw new Error(c.error || 'not available');
  if (ui.connected) await ui.disconnect();   // a proof is only produced on a fresh connection
  ui.setConnectRequestParameters({ state: 'ready', value: { tonProof: c.payload } });
  return new Promise<string>((resolve, reject) => {
    const off = ui.onStatusChange(async (w: any) => {
      const proof = w?.connectItems?.tonProof?.proof;
      if (!w || !proof) return;
      off();
      try {
        const r = await (await fetch('/api/zenobia/ref/link', { method: 'POST', headers: hdr, body: JSON.stringify({ account: w.account, proof }) })).json();
        if (r.error) reject(new Error(r.error)); else resolve(r.address);
      } catch (e) { reject(e); }
    });
    void ui.openModal();
  });
};
