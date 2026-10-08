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
    slug: "anne-carson-nobel-literature-2026",
    title: "Anne Carson wins 2026 Nobel Prize in Literature",
    dek: "The Swedish Academy named Canadian poet Anne Carson on 8 October 2026 for work that recasts classical forms. Medal ceremony is 10 December in Stockholm.",
    date: "2026-10-08",
    body: [
      "The Swedish Academy awarded the 2026 Nobel Prize in Literature to Anne Carson, the Canadian poet, essayist, and translator. The announcement was made in Stockholm on 8 October 2026.",
      "The official citation is for her bold and inventive oeuvre that, in playful dialogue with the classical tradition, has created new forms for contemporary literature. Carson was born in Toronto in 1950. Her first book, Eros the Bittersweet, appeared in 1986.",
      "The medal and diploma are presented in Stockholm on 10 December, the anniversary of Alfred Nobel's death. This note uses the Academy citation and the public announcement; it is not a review of her books.",
      "Primary source: the Nobel Prize page for Literature 2026. A same-day report is on The Guardian.",
    ],
    tool: "/en/articles",
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
    slug: "short-links-and-click-counts",
    title: "A short link is a counter, not a brand",
    dek: "Shortening a URL is useful when you need a click count. It is a poor place to hide the destination.",
    date: "2026-10-05",
    body: [
      "A short link helps on a printed card and in a chat where a long URL breaks. The count tells you if anyone opened it.",
      "Do not use a short link to disguise where it goes. Show the destination in the text next to it.",
    ],
    tool: "/en/free-tools/url-shortener",
  },
  {
    slug: "vat-inclusive-prices",
    title: "Tax-inclusive prices hide the rate",
    dek: "A shelf price can include tax. The calculator has to know which way you are going.",
    date: "2026-10-04",
    body: [
      "Adding 20 percent to a net price is not the same as removing 20 percent from a gross price. The second move uses the rate divided by one plus the rate.",
      "Write the rate on the invoice. A calculator that only adds tax will mis-state a price that already includes it.",
    ],
    tool: "/en/free-tools/vat-calculator",
  },
];

export const EN_ARTICLES: DeskItem[] = [
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
    slug: "one-page-cv",
    title: "How to keep a CV to one page",
    dek: "Role, dates, and one result per job. A second page rarely gets read.",
    date: "2026-09-28",
    body: [
      "Lead with the role you want, then three jobs. Each job gets a title, dates, and one line that names a result.",
      "Drop school dates if you have three years of work. A one-page CV is easier to send and easier to scan.",
    ],
    tool: "/en/free-tools/cv-generator",
  },
];

export const EN_EVENTS: DeskItem[] = [
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
    slug: "public-domain-day-2027",
    title: "Public Domain Day 2027",
    dek: "1 January. Works whose term ends enter the commons in many countries.",
    date: "2027-01-01",
    body: [
      "Public Domain Day is 1 January. The list of works differs by country because copyright terms differ.",
      "Do not copy a text into a tool page because a headline said it is free. Check the country and the year.",
    ],
  },
  {
    slug: "safer-internet-day-2027",
    title: "Safer Internet Day 2027",
    dek: "A February date used by schools and networks for ordinary online safety.",
    date: "2027-02-09",
    body: [
      "Safer Internet Day falls in February. Campaigns usually cover passwords, shared photos, and links you did not expect.",
      "A short link should show where it goes. A tool that keeps a file in the browser is easier to explain than one that uploads it.",
    ],
  },
];

export function bySlug(list: DeskItem[], slug: string) {
  return list.find((item) => item.slug === slug);
}
