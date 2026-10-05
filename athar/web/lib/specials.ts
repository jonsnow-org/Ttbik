// Special dates: a note about the day and (when the owner has supplied one) a hand-made artwork.
// To give a date its own artwork, put a file named YYYY-MM-DD.webp (or .jpg/.png, under 66 KB) in web/special/ .
import fs from "fs";
import path from "path";
import { SEASON_1, specialIndex } from "./seasons";
import { ymd } from "./dates";
import { eventEnOf } from "./specialNames";

const EN: Record<string, string> = {
  "1953-4-25": "The structure of DNA is published", "1957-10-4": "Sputnik, the first satellite", "1961-4-12": "Gagarin, the first human in space",
  "1962-2-20": "John Glenn orbits the Earth", "1963-8-28": "\"I have a dream\"", "1969-7-20": "Humans land on the Moon",
  "1969-10-29": "First message on the early Internet", "1971-12-2": "UAE National Day", "1976-4-1": "Apple is founded", "1977-5-25": "Star Wars is released",
  "1981-4-12": "First Space Shuttle flight", "1985-7-13": "Live Aid", "1986-6-22": "Maradona's famous match", "1989-3-12": "The World Wide Web proposal",
  "1989-11-9": "The Berlin Wall falls", "1990-2-11": "Mandela is released", "1990-4-24": "Hubble telescope launch", "1990-10-3": "German reunification",
  "1991-8-6": "The first website", "1993-4-30": "The Web is given to the public", "1997-6-26": "Harry Potter is published", "1998-7-12": "1998 World Cup final",
  "1998-9-4": "Google is founded", "2008-10-31": "The Bitcoin whitepaper", "2009-1-3": "The first Bitcoin block", "2010-5-22": "Bitcoin Pizza Day",
  "2012-7-4": "The Higgs boson announcement", "2013-8-14": "Telegram launches", "2015-7-30": "Ethereum begins", "2019-4-10": "First image of a black hole",
  "2022-11-20": "Opening of the Qatar World Cup", "2022-12-18": "2022 World Cup final",
};

export function specialOf(index: number) {
  const s = SEASON_1.specials.find((x) => specialIndex(x) === index);
  if (!s) return null;
  const { y, m, d } = ymd(index);
  const stem = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const hasArt = ["webp", "jpg", "png"].some((e) => fs.existsSync(path.join(process.cwd(), "special", `${stem}.${e}`)));
  return { ar: s.note, en: eventEnOf(y, m, d) || EN[`${y}-${m}-${d}`] || s.note, tier: s.tier, hasArt };
}
