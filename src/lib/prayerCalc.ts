import { METHOD_ANGLES, type PrayerCity } from "./prayerCities";

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

function julianDay(date: Date, lng: number) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  const dayFrac = (date.getUTCHours() + date.getUTCMinutes() / 60 - lng / 15) / 24;
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return (
    d +
    dayFrac +
    Math.floor((153 * mm + 2) / 5) +
    365 * yy +
    Math.floor(yy / 4) -
    Math.floor(yy / 100) +
    Math.floor(yy / 400) -
    32045
  );
}

function sunDeclination(jd: number) {
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = toRad((357.528 + 0.9856003 * n) % 360);
  const lambda = toRad(L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g));
  const eps = toRad(23.439 - 0.0000004 * n);
  return Math.asin(Math.sin(eps) * Math.sin(lambda));
}

function equationOfTimeMinutes(jd: number) {
  const n = jd - 2451545.0;
  const g = toRad(357.528 + 0.9856003 * n);
  const q = 280.46 + 0.9856474 * n;
  const L = q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g);
  const RA = toDeg(Math.atan2(Math.cos(toRad(23.439)) * Math.sin(toRad(L)), Math.cos(toRad(L))));
  let eot = 4 * (q - RA);
  while (eot > 720) eot -= 1440;
  while (eot < -720) eot += 1440;
  return eot;
}

function hourAngle(lat: number, decl: number, angleDeg: number) {
  const latR = toRad(lat);
  const a = toRad(-angleDeg);
  const cosH =
    (Math.sin(a) - Math.sin(latR) * Math.sin(decl)) / (Math.cos(latR) * Math.cos(decl));
  const clamped = Math.min(1, Math.max(-1, cosH));
  return toDeg(Math.acos(clamped));
}

function asrHourAngle(lat: number, decl: number) {
  const latR = toRad(lat);
  const angle = toDeg(Math.atan(1 / (1 + Math.tan(Math.abs(latR - decl)))));
  return hourAngle(lat, decl, 90 - angle);
}

function minutesFromSolarNoon(haDeg: number) {
  return (haDeg / 15) * 60;
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

  const utcGuess = Date.UTC(y, m - 1, d, 12, 0, 0);
  const jd = julianDay(new Date(utcGuess), city.lng);
  const decl = sunDeclination(jd);
  const eot = equationOfTimeMinutes(jd);

  const utcSolarNoon = Date.UTC(y, m - 1, d, 12, 0, 0) + (eot - city.lng * 4) * 60_000;
  const noon = new Date(utcSolarNoon);

  const angles = METHOD_ANGLES[city.method];
  const fajrHa = hourAngle(city.lat, decl, angles.fajr);
  const sunriseHa = hourAngle(city.lat, decl, 0.833);
  const asrHa = asrHourAngle(city.lat, decl);
  const maghribHa = hourAngle(city.lat, decl, 0.833);
  const ishaHa =
    city.method === "umm_al_qura"
      ? maghribHa + (angles.maghribMin / 60) * 15
      : hourAngle(city.lat, decl, angles.isha);

  const mk = (offsetMin: number) => ({
    label: clockInTz(noon, offsetMin, city.tz),
    date: new Date(noon.getTime() + offsetMin * 60_000),
  });

  const times = {
    fajr: mk(-minutesFromSolarNoon(fajrHa)),
    sunrise: mk(-minutesFromSolarNoon(sunriseHa)),
    dhuhr: mk(1),
    asr: mk(minutesFromSolarNoon(asrHa)),
    maghrib: mk(minutesFromSolarNoon(maghribHa)),
    isha: mk(minutesFromSolarNoon(ishaHa)),
  } as const;

  const order: PrayerName[] = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"];
  let next: PrayerName = "fajr";
  for (const name of order) {
    if (times[name].date.getTime() > when.getTime()) {
      next = name;
      break;
    }
  }

  return {
    times,
    next,
    qibla: qiblaDegrees(city.lat, city.lng),
    hijri: hijriLabel(when, city.tz),
    gregorian: gregorianLabel(when, city.tz),
  };
}
