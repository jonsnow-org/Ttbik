"use client";

import { useEffect } from "react";

/**
 * Retired 2026-09-22 (owner report, repeated/escalating: the homepage's
 * bot cards force-closing the browser+Telegram, and separately "كأنه يوجد
 * صفحتين فوق بعضهما البعض" -- as if an old, hidden version of the page
 * keeps showing underneath a new one). Root cause: this used to REGISTER
 * public/sw_1.js, a service worker entirely written and controlled by a
 * third-party ad network (3nbf4.com) via `importScripts(...)` from their
 * own domain -- opaque to us, no visibility into what it actually does.
 * A service worker registered at the site root (`/sw_1.js`, no explicit
 * `scope`) gets the WIDEST possible scope: every single page on the whole
 * origin, not just wherever it was registered from. Once installed on a
 * visitor's device it persists across every future visit and can
 * intercept and serve cached (stale) responses for ANY page indefinitely
 * -- regardless of what we deploy server-side afterward. That fully
 * matches both symptoms: a fix that's confirmably live on the server (we
 * verified the deployed HTML directly) still not taking effect for a
 * returning visitor, and the "two pages stacked" sensation of an old
 * cached page silently winning over the real one.
 *
 * Given we cannot audit or control what that third-party script actually
 * does, the ad revenue from one network isn't worth an invisible,
 * unauditable request-interception layer sitting over the whole site --
 * removed for good, and every returning visitor who already has it
 * installed gets it actively unregistered (plus its Cache Storage
 * purged) the next time they load any page.
 */
export default function AdServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => Promise.all(regs.map((r) => r.unregister())))
      .catch(() => {
        // best-effort only -- nothing to fall back to here
      });
    if ("caches" in window) {
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .catch(() => {});
    }
  }, []);
  return null;
}
