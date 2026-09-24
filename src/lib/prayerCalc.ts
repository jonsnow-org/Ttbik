import { CalculationMethod, CalculationParameters, Coordinates, Madhab, PrayerTimes } from "adhan";
import type { PrayerCity } from "./prayerCities";

export type PrayerName = "fajr" | "sunrise" | "dhuhr" | "asr" | "maghrib" | "isha";

export const PRAYER_LABELS: Record<PrayerName, string> = {
  fajr: "الفجر",
  sunrise: "الشروق",
  dhuhr: "الظهر",
  asr: "العصر",
  maghrib: "المغرب",
  isha: "العشاء",
};

const KAABA = { lat: 21.4225, lng: 39.8262 };

function toRad(d: number) {
  return (d * Math.PI) / 180;
}
function toDeg(r: number) {
  return (r * 180) / Math.PI;
}

function clockInTz(base: Date, offsetMin: number, tz: string) {
  const d = new Date(base.getTime() + offsetMin * 60_000);
  return new Intl.DateTimeFormat("ar-EG", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

export function qiblaDegrees(lat: number, lng: number) {
  const p1 = toRad(lat);
  const p2 = toRad(KAABA.lat);
  const dl = toRad(KAABA.lng - lng);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function hijriLabel(date: Date, tz: string) {
  return new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function gregorianLabel(date: Date, tz: string) {
  return new Intl.DateTimeFormat("ar-EG", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

// Times come from the `adhan` library (the reference implementation of the
// standard methods). A hand-rolled solar calculation here was ~16 minutes off
// and produced a nonsensical Asr, so it was replaced.
function adhanParams(city: PrayerCity) {
  let params: CalculationParameters;
  switch (city.method) {
    case "umm_al_qura":
      params = CalculationMethod.UmmAlQura();
      break;
    case "egyptian":
      params = CalculationMethod.Egyptian();
      break;
    case "karachi":
      params = CalculationMethod.Karachi();
      break;
    default:
      params = CalculationMethod.MuslimWorldLeague();
  }
  params.madhab = Madhab.Shafi;
  return params;
}

export function computePrayerTimes(city: PrayerCity, when = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: city.tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(when);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);

  // adhan reads only the calendar day (y/m/d) from this Date.
  const pt = new PrayerTimes(new Coordinates(city.lat, city.lng), new Date(y, m - 1, d), adhanParams(city));
  const mk = (date: Date) => ({ label: clockInTz(date, 0, city.tz), date });

  const times = {
    fajr: mk(pt.fajr),
    sunrise: mk(pt.sunrise),
    dhuhr: mk(pt.dhuhr),
    asr: mk(pt.asr),
    maghrib: mk(pt.maghrib),
    isha: mk(pt.isha),
  } as const;

  const order: PrayerName[] = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"];
  let next: PrayerName = "fajr";
  // After Isha the next prayer is tomorrow's Fajr, not today's (already past).
  let nextDate = new PrayerTimes(new Coordinates(city.lat, city.lng), new Date(y, m - 1, d + 1), adhanParams(city)).fajr;
  for (const name of order) {
    if (times[name].date.getTime() > when.getTime()) {
      next = name;
      nextDate = times[name].date;
      break;
    }
  }

  return {
    times,
    next,
    nextDate,
    qibla: qiblaDegrees(city.lat, city.lng),
    hijri: hijriLabel(when, city.tz),
    gregorian: gregorianLabel(when, city.tz),
  };
}
