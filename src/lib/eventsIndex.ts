/** Canonical event index. Event cards currently live in eventsExtra.ts; keep this module as the typed compatibility surface used by pages, sitemap and channel rotation. */
export type EventSource = { href: string; label: string };
export type EventFaq = { q: string; a: string };

export type EventItem = {
  slug: string;
  title: string;
  dateIso: string;
  dateLabel: string;
  category: string;
  imageUrl?: string;
  blurb: string;
  description: string;
  paragraphs: string[];
  faq: EventFaq[];
  sources: EventSource[];
};

import { EVENT_EXTRAS } from "@/lib/eventsExtra";

/** Events maintained in the editorial extras index; deduplicated by consumers when combining both lists. */
export const EVENT_ITEMS: EventItem[] = [];

export function getEvent(slug: string): EventItem | undefined {
  return EVENT_ITEMS.find((event) => event.slug === slug);
}

export function latestEvent(): EventItem | undefined {
  return [...EVENT_ITEMS, ...EVENT_EXTRAS]
    .sort((a, b) => b.dateIso.localeCompare(a.dateIso))[0];
}
