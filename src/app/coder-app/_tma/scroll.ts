"use client";
// Live-feed scrolling that does not fight the reader.
//
// The task feed used `end.scrollIntoView({ behavior: "smooth" })` on every new event. In the Telegram webview (iOS
// especially) a smooth scrollIntoView re-anchors the scroll container on each poll (every 1.5 s while a task runs),
// so the view is yanked upward — and a user who scrolled up to read a long answer is dragged back down mid-read.
//
// This hook follows the tail only when the reader is already at (or very near) the bottom, and it jumps instantly
// (no smooth animation). A reader who scrolls up is left exactly where they are until they return to the bottom.
import { useEffect, useLayoutEffect, useRef } from "react";

/** True when the element is scrolled to within `threshold` px of the bottom. */
export function isNearBottom(el: { scrollTop: number; scrollHeight: number; clientHeight: number }, threshold = 80): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
}

/** The nearest scrollable ancestor of `node` (the element the feed actually scrolls inside). */
export function scrollParent(node: HTMLElement | null): HTMLElement | null {
  let el = node?.parentElement ?? null;
  while (el) {
    const style = getComputedStyle(el);
    if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 4) return el;
    el = el.parentElement;
  }
  return null;
}

/**
 * The element the whole page scrolls inside (the Telegram webview scrolls the document). Used as the fallback
 * scroller when the feed has no scrollable ancestor of its own — otherwise the page case attached no scroll
 * listener and `stick` stayed true forever, so a reader who scrolled up was yanked back on every live update.
 */
export function pageScroller(doc: Document | null = typeof document === "undefined" ? null : document): HTMLElement | null {
  return (doc?.scrollingElement as HTMLElement | null) || doc?.documentElement || null;
}

/** The element to read scroll geometry from, and the target that carries its scroll events (window for the page). */
export function resolveScroller(el: HTMLElement | null): { scroller: HTMLElement | null; target: EventTarget | null } {
  const inner = scrollParent(el);
  if (inner) return { scroller: inner, target: inner };
  const doc = el?.ownerDocument ?? null;
  return { scroller: pageScroller(doc), target: doc?.defaultView ?? null };
}

/**
 * Returns a ref to attach to the end sentinel of a live feed. Whenever `deps` change (a new event arrived), the feed is
 * scrolled to the bottom — but only if the reader had not scrolled away, and instantly, never with a smooth animation.
 */
export function useStickToBottom(deps: unknown[], threshold = 80) {
  const endRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const { scroller, target } = resolveScroller(endRef.current);
    if (!scroller || !target) return;
    const onScroll = () => { stick.current = isNearBottom(scroller, threshold); };
    target.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => target.removeEventListener("scroll", onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threshold]);

  useLayoutEffect(() => {
    if (!stick.current) return;                             // the reader scrolled up: do not move the view
    const { scroller } = resolveScroller(endRef.current);
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return endRef;
}
