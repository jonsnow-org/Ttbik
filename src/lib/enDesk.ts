export type DeskItem = {
  slug: string;
  title: string;
  dek: string;
  date: string;
  body: string[];
  tool?: string;
};

export const EN_NEWS: DeskItem[] = [
  {
    slug: "world-post-day-2026",
    title: "World Post Day is 9 October",
    dek: "The date marks the 1874 founding of the Universal Postal Union in Bern. The 2026 UN theme is one postal network, not a courier advert.",
    date: "2026-10-09",
    body: [
      "World Post Day falls on 9 October. The Universal Postal Union was founded in Bern in 1874, and its Tokyo congress in 1969 set this date as the annual observance. The United Nations lists it because the UPU has been a specialised agency since 1948.",
      "The 2026 message published by the UN is about one postal network and the services a post office still provides where a bank or a digital counter does not. The UN cites about 660,000 offices and about 4.6 million staff.",
      "This note is not a shipping rate and not a brand page. The source is the UN observance page.",
    ],
    tool: "/en/events/upcoming",
  },
  {
    slug: "anne-carson-nobel-literature-2026",
    title: "Anne Carson wins 2026 Nobel Prize in Literature",
    dek: "The Swedish Academy named Canadian poet Anne Carson on 8 October 2026 for work that recasts classical forms. Medal ceremony is 10 December in Stockholm.",
    date: "2026-10-08",
    body: [
      "The Swedish Academy awarded the 2026 Nobel Prize in Literature to Anne Carson, the Canadian poet, essayist, and translator. The announcement was made in Stockholm on 8 October 2026.",
      "The official citation is for her bold and inventive oeuvre that, in playful dialogue with the classical tradition, has created new forms for contemporary literature. Carson was born in Toronto in 1950. Her first book, Eros the Bittersweet, appeared in 1986.",
      "The medal and diploma are presented in Stockholm on 10 December, the anniversary of Alfred Nobel's death. This note uses the Academy citation and the public announcement; it is not a review of her books.",
    ],
    tool: "/en/articles",
  },
  {
    slug: "navi-pillay-nobel-peace-2026",
    title: "Navi Pillay awarded 2026 Nobel Peace Prize",
    dek: "Former ICC judge Navi Pillay recognized for efforts on human rights and international law. Announcement 9 October 2026.",
    date: "2026-10-09",
    body: [
      "The Norwegian Nobel Committee awarded the 2026 Nobel Peace Prize to Navi Pillay, the South African jurist and former judge at the International Criminal Court and UN High Commissioner for Human Rights.",
      "The prize recognizes her long work on accountability and international justice. This note relies on the official announcement and contemporaneous agency reports; it does not speculate on political reactions.",
    ],
    tool: "/en/articles",
  },
  {
    slug: "hurricane-isaias-gulf-2026",
    title: "Hurricane Isaias approaches US Gulf Coast",
    dek: "Category 3 storm nears landfall. Live updates from agencies and broadcasters as of 9-10 October 2026.",
    date: "2026-10-09",
    body: [
      "Hurricane Isaias strengthened and moved toward the northern Gulf Coast of the United States in early October 2026. Agencies and outlets reported landfall risk near the Florida Panhandle and Alabama.",
      "This desk note points to official forecasts and live streams rather than repeating changing casualty or path numbers. Open the live desks above or the National Hurricane Center for the latest.",
    ],
    tool: "/en/news",
  },
  {
    slug: "browser-tools-keep-files-local",
    title: "Browser tools that never upload the file",
    dek: "A size check, a QR code, and an invoice can run on the device. The useful part is what does not leave the tab.",
    date: "2026-10-07",
    body: [
      "Searchers looking for a free image compressor or invoice maker usually land on a tool that asks for an account before the first result. A browser tool can do the same job in the tab.",
      "That matters for a photo you do not want on a server, and for a price you only need once. The English desk links each note to a tool that runs without a signup.",
    ],
    tool: "/en/free-tools/image-optimizer",
  },
  {
    slug: "qr-codes-for-menus-and-wifi",
    title: "QR codes are back on menus and Wi-Fi cards",
    dek: "A code is only useful if the link behind it still opens. Generate it, test it, then print.",
    date: "2026-10-06",
    body: [
      "Restaurants and small shops still print a code for a menu or a Wi-Fi name. The failure is almost always a dead link, not the square itself.",
      "Generate the code, open it on a second phone, then print. A code for a link you control is easier to replace than a code baked into a PDF.",
    ],
    tool: "/en/free-tools/qr-generator",
  },
  {
    slug: "world-mental-health-day-2026-note",
    title: "World Mental Health Day is 10 October",
    dek: "Annual observance with the World Federation for Mental Health and WHO. Not medical advice.",
    date: "2026-10-10",
    body: [
      "World Mental Health Day falls on 10 October. The World Federation for Mental Health has marked the date since 1992. WHO maintains a campaign page for the same day.",
      "This note explains the public date. It is not a diagnosis and not a treatment recommendation. Anyone needing urgent help should use a local emergency service.",
    ],
    tool: "/en/events",
  },
];

export const EN_ARTICLES: DeskItem[] = [
  {
    slug: "how-to-check-a-public-date",
    title: "How to check a public date before you share it",
    dek: "A day name in a headline is not a source. Open the organiser page and read the year.",
    date: "2026-10-09",
    body: [
      "A shared post often moves a date by a day, or keeps last year's theme. Before you repeat it, open the page of the body that owns the day: the UN, WHO, FAO, or the academy that made the award.",
      "Check three things: the calendar date, the year on the page, and whether the theme is for this year. A theme from 2024 on a 2026 card is a stale copy.",
      "If two outlets disagree, link both and say so. Do not pick the rounder number.",
    ],
    tool: "/en/events",
  },
  {
    slug: "how-to-calculate-bmi",
    title: "How to calculate BMI without a clinic form",
    dek: "Weight in kilograms divided by height in metres squared. The number is a screen, not a diagnosis.",
    date: "2026-10-03",
    body: [
      "BMI is weight divided by height squared. Use kilograms and metres. A result between 18.5 and 24.9 is the usual adult range printed on public charts.",
      "The number does not see muscle, age, or pregnancy. Use it to compare two readings, then talk to a clinician if the change is the question.",
    ],
    tool: "/en/free-tools/bmi-calculator",
  },
  {
    slug: "how-to-add-or-remove-vat",
    title: "How to add or remove VAT from a price",
    dek: "Net plus tax, or gross back to net. Pick one direction before you type.",
    date: "2026-10-02",
    body: [
      "To add tax, multiply the net price by one plus the rate. A 100 price at 20 percent becomes 120.",
      "To remove tax from a gross price, divide by one plus the rate. 120 at 20 percent returns 100. Subtracting 20 percent from 120 gives the wrong net.",
    ],
    tool: "/en/free-tools/vat-calculator",
  },
  {
    slug: "whatsapp-click-to-chat",
    title: "How to make a WhatsApp click-to-chat link",
    dek: "A wa.me link opens a chat with a number. The message can be filled in, the send still belongs to the visitor.",
    date: "2026-10-01",
    body: [
      "Use the country code and drop the leading zero. A UK mobile 07123 becomes 447123 in the link.",
      "Put the offer in the page, not only in the prefilled text. The visitor can edit the message before it sends.",
    ],
    tool: "/en/free-tools/whatsapp-link",
  },
  {
    slug: "why-live-desks-matter",
    title: "Why we embed official live desks instead of rebroadcasting",
    dek: "The stream stays on the channel's player. We do not copy the signal.",
    date: "2026-10-10",
    body: [
      "A live news desk on this site is an official YouTube embed. The video leaves the channel's servers only when you open the player. Sham AI does not rebroadcast or store the stream.",
      "If an embed stops, the Open on YouTube button goes to the channel's live page. That is the reliable source.",
    ],
    tool: "/en/news",
  },
];

export const EN_EVENTS: DeskItem[] = [
  {
    slug: "world-post-day-2026",
    title: "World Post Day 2026",
    dek: "9 October. Anniversary of the Universal Postal Union, founded in Bern in 1874.",
    date: "2026-10-09",
    body: [
      "World Post Day is 9 October. The Universal Postal Union was established in Bern in 1874. The UN observance page is the source for the date and for the 2026 theme, one postal network.",
      "It is not a public holiday in most countries and not a shipping sale.",
    ],
  },
  {
    slug: "world-mental-health-day-2026",
    title: "World Mental Health Day 2026",
    dek: "10 October. A public date run with the World Federation for Mental Health and marked by WHO. Not medical advice.",
    date: "2026-10-10",
    body: [
      "World Mental Health Day is 10 October. The World Federation for Mental Health has used the date since 1992. WHO keeps a campaign page for the same day.",
      "This card explains the date. It is not a diagnosis and not a treatment. Someone who needs urgent help should use a local emergency service.",
    ],
  },
  {
    slug: "international-day-of-the-girl-2026",
    title: "International Day of the Girl 2026",
    dek: "11 October. Declared by the General Assembly. The 2026 UN and UNICEF theme is ending child marriage.",
    date: "2026-10-11",
    body: [
      "The International Day of the Girl Child is 11 October. The General Assembly set the date in resolution 66/170 on 19 December 2011.",
      "The 2026 theme published by the UN and UNICEF is to end child marriage and invest in girls' rights. UNICEF's public estimate is that about one in five girls is married before 18.",
    ],
  },
  {
    slug: "disaster-risk-reduction-day-2026",
    title: "International Day for Disaster Risk Reduction 2026",
    dek: "13 October. A UN date about preparation, not a forecast of a named storm.",
    date: "2026-10-13",
    body: [
      "The International Day for Disaster Risk Reduction is 13 October. The UN page is the source. The day is about reducing loss before a disaster, not about predicting one.",
    ],
  },
  {
    slug: "world-standards-day-2026",
    title: "World Standards Day 2026",
    dek: "14 October. A public date for the standards behind files, plugs, and web formats.",
    date: "2026-10-14",
    body: [
      "World Standards Day is 14 October. It marks the work behind shared formats: image types, paper sizes, and the rules that let a file open on another machine.",
      "For a tool site the useful part is practical. A QR code, a PDF invoice, and a JPEG all depend on a published format.",
    ],
  },
  {
    slug: "world-food-day-2026",
    title: "World Food Day 2026",
    dek: "16 October. Anniversary of the founding of the Food and Agriculture Organization in 1945.",
    date: "2026-10-16",
    body: [
      "World Food Day is 16 October, the date FAO was founded in 1945. The FAO page is the source. The day is about hunger and farming, not a commodity price.",
    ],
  },
  {
    slug: "public-domain-day-2027",
    title: "Public Domain Day 2027",
    dek: "1 January. Works whose term ends enter the commons in many countries.",
    date: "2027-01-01",
    body: [
      "Public Domain Day is 1 January. The list of works differs by country because copyright terms differ.",
      "Do not copy a text into a tool page because a headline said it is free. Check the country and the year.",
    ],
  },
];

export function bySlug(list: DeskItem[], slug: string) {
  return list.find((item) => item.slug === slug);
}
