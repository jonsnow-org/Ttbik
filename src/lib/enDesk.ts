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
    slug: "ai-compute-shortages-may-last-to-2027",
    title: "AI computing shortages may continue into 2027, Google CEO says",
    dek: "Sundar Pichai says demand for AI compute exceeds supply across the industry. Capacity planned in 2024 is already tight, and securing 2027 slots is difficult.",
    date: "2026-10-24",
    body: [
      "Alphabet and Google CEO Sundar Pichai said in a recent interview that the AI industry faces ongoing shortages of computing capacity. He noted that nearly every company is short of what it needs, and that many would prefer twice the capacity they currently have planned.",
      "Pichai explained that the compute Google can offer today reflects investment decisions made in 2024. Meeting a customer request for capacity in 2027 is already “incredibly difficult.” The company is prioritizing frontier AI research and model development, even when that means Google Cloud forgoes some short-term revenue.",
      "For users and developers this can mean rate limits or slower access on large models. For businesses it underlines the need for multi-year capacity planning. This note reports public statements; it is not a forecast or investment advice.",
    ],
    tool: "/en/news",
  },
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
    slug: "why-gold-and-the-dollar-move-opposite",
    title: "Why gold and the dollar often move in opposite directions (and when they don't)",
    dek: "Three mechanisms explain the usual inverse link, and one situation breaks it. Questions to ask before you read meaning into a one-day move.",
    date: "2026-10-11",
    body: ["Watch a markets ticker for a few weeks and a pattern appears: when the dollar firms, gold tends to slip, and when the dollar softens, gold tends to rise. It is not a law of nature. It is the net result of several forces that sometimes reinforce each other and sometimes collide.", "The first is pricing. Gold is quoted in US dollars worldwide. If the dollar strengthens against the euro or the yen, an ounce costs more for someone holding those currencies. Higher cost lowers their demand at the same dollar price, which weighs on the quote. A weaker dollar works the other way.", "The second is opportunity cost. Gold pays no interest and no dividend. When yields on dollar bonds and deposits rise, holding gold means giving up more income, so some investors prefer assets that pay. When yields fall, or markets expect them to, that cost shrinks. The cleaner measure is the real yield: the interest rate after subtracting expected inflation, not the headline rate alone.", "The third is safety. In a scare, investors often buy both the dollar and gold at the same time. Both rise together and the inverse relationship disappears for a while. That is exactly when relying on the rule alone misleads.", "Other drivers are partly independent of the dollar: central banks adding to reserves, jewellery demand around wedding and festival seasons, and flows into gold funds. Not every move should be pinned on the currency.", "A practical checklist before you explain today's price: did the dollar move, did expectations for interest rates change, and was there frightening news? If all three answers are no, the move may be noise that does not justify a decision. This explains mechanisms; it is not investment advice."],
    tool: "/en/markets",
  },
  {
    slug: "five-forces-that-move-exchange-rates",
    title: "Five forces that move an exchange rate: how to read a currency ticker",
    dek: "Interest-rate gaps, inflation, trade, capital flows and confidence. A framework for explaining why one currency rose against another.",
    date: "2026-10-11",
    body: ["An exchange rate is the price of one currency in terms of another, set in the end by supply and demand for each. What moves that supply and demand can be grouped into five forces that recur in most episodes.", "First, interest-rate differentials. Money seeks yield. When one country raises rates while others hold, its assets become more attractive and demand for its currency grows. What matters most is the expected change in rates, not just the level, because markets price news before it arrives.", "Second, inflation. If prices rise faster at home than among trading partners, the currency's purchasing power erodes, and over the long run it tends to weaken. A central bank may respond with higher rates, so the two forces interact.", "Third, trade and services. A country that exports more than it imports sees foreign buyers needing its currency to pay. Persistent deficits, especially financed by borrowing, lean the other way.", "Fourth, capital flows: foreign investment, bond purchases and remittances. For economies that depend on money sent home by workers abroad, seasonal remittance patterns can leave visible marks on the market.", "Fifth, confidence and politics. Strong institutions, an independent central bank and clear policy attract capital; their absence pushes it out. Where an official rate and a parallel-market rate coexist, the gap between them is a direct gauge of mistrust or restricted access.", "To read a ticker, never look at one pair in isolation. Ask which of the two currencies had news today, then look for the strongest of the five forces. This is a way to explain moves, not a forecast of prices."],
    tool: "/en/markets",
  },
  {
    slug: "news-analysis-opinion-how-to-tell-apart",
    title: "News, analysis or opinion? How to tell them apart in a minute",
    dek: "Many arguments over 'the news' come from mixing three kinds of writing. Practical signs for each, and the mistakes readers make most.",
    date: "2026-10-11",
    body: ["Readers often blur news, analysis and opinion because all three can appear on one page in the same typeface. Each has a different job, and judging a piece by a job it never promised leads to bad arguments.", "News answers who did what, when and where, and attributes each claim to a source you could trace. Its language is descriptive and it does not pass judgement. If you meet words like 'scandal' or 'crushing victory' with no one quoted, the text has stepped outside its role.", "Analysis explains why something happened and what may follow. It builds on the facts of the news and adds context, data and questions. Good analysis lays out several possibilities and says where its own reasoning is weak. Poor analysis offers a single prediction with total confidence.", "Opinion argues for a position. The writer may take sides, but should say so. Ask whether the facts the argument rests on are correct and whether inconvenient facts were left out.", "Before you share, find the author or organisation, the publication date, and a link to a primary source such as a statement, document or recording. Then compare with a second, independent outlet. If the facts match but the interpretations differ, you are looking at two analyses, not two contradictory news reports.", "The costliest mistake is passing off opinion as news: the headline says 'revealed' while the body says 'observers believe'. Open the text and find out who the observers are before you repost."],
    tool: "/en/news",
  },
  {
    slug: "verify-a-viral-photo-or-video",
    title: "Before you share that viral photo or clip: five checks that need no special software",
    dek: "Most misleading images are real pictures attached to the wrong event. Trace the origin, date and place first.",
    date: "2026-10-11",
    body: ["The most common misleading image is not faked at all. It is a real photo from an old earthquake, flood or protest posted as if it were today's. So the first question is not 'is it real?' but 'when and where is it from?'.", "Check one: reverse image search. Upload the picture to a search-by-image service such as Google Lens, TinEye or Bing Visual Search and look for the earliest appearance. A copy from years ago usually settles it.", "Check two: for video, grab frames from the beginning, middle and end and search with them the same way. Many viral clips are cut from longer footage in a way that changes the meaning.", "Check three: place and time. Look for verifiable details such as signs and their language, number plates, building styles, weather and shadows, and compare them with maps and street-level imagery. One contradiction is enough to sink a claim.", "Check four: signs of generation or editing. In AI images look at hands, teeth, garbled text on signs and inconsistent lighting. Do not rely on these alone, because tools keep improving, but several together raise suspicion.", "Check five: who posted it first? An anonymous account with no history that urges you to 'share before it is deleted' deserves caution. If you cannot verify it, do not share it. No single test is decisive; verification is built from accumulated evidence."],
    tool: "/en/articles",
  },
  {
    slug: "what-free-really-costs-online",
    title: "What 'free' really costs online: a reader's guide",
    dek: "A free app is rarely free of cost. Attention, data or a later upgrade is the price. How to tell the models apart and what to ask before signing up.",
    date: "2026-10-11",
    body: ["'Free' online usually means you pay no money, not that you pay nothing. The way to find the price is to ask how the provider earns, because servers and developers are not free.", "Model one is free with ads. The price is your attention and some behavioural data. That is fair if ads are clearly marked and do not block the use of the service, and it is what keeps many free sites alive.", "Model two is free in exchange for data. You create an account and grant broad permissions. Ask whether the service truly needs your contacts or location, whether data is sold or shared, and read the privacy policy to find out.", "Model three is free, then paid. A trial tool draws you in and later locks the feature you need. This is legitimate when stated up front and a trap when you discover the limit after uploading your files.", "A rarer fourth group runs entirely inside your browser, so the file or text never reaches a server. These cost the least in privacy. You can test the claim by loading the page, going offline and checking the tool still works.", "A rule of thumb before you register: can I use it without an account, what is the minimum permission that works, and how do I delete my data? If there is no quick answer, the real price is probably higher than it looks."],
    tool: "/en/free-tools",
  },
  {
    slug: "how-nobel-prizes-are-chosen-and-what-it-tells-you",
    title: "How the Nobel Prizes are chosen, and what the announcement really tells you",
    dek: "Who nominates, who decides, and why the lists stay secret for fifty years. A calm way to read a prize headline.",
    date: "2026-10-11",
    body: ["Every autumn the pattern repeats: a Nobel winner is named and headlines pile on superlatives. To read the news well it helps to know how the prizes work, because they mean something narrower than many assume.", "The prizes rest on the will of Alfred Nobel, and different bodies choose in different fields: the Swedish Academy for literature, the Norwegian Nobel Committee for peace, and Swedish scientific institutions for physics, chemistry and medicine. 'The Nobel' is therefore several independent bodies, and their standards are not directly comparable.", "Nominations are mostly by invitation. The committees invite qualified people, such as university professors and former laureates, to submit names. The statutes keep the names of nominees and the investigations secret for fifty years, so every list of 'likely nominees' you read today is journalistic guesswork, not official information.", "The announcement itself carries a short statement called the citation. It is the most precise description of what the winner is honoured for, and better than any headline. Read it: is it for one body of work or a career? That changes the meaning of the story.", "A prize reflects a human decision by one committee in one year. It does not mean those not chosen contributed less. People have disagreed over some decisions, especially in peace and literature, where judgement plays a larger role than in the sciences.", "When you cover or share a win, look for three things: the citation from the awarding body, the date of the announcement and the date of the ceremony. Everything else, description and analysis, should be attributed to whoever said it."],
    tool: "/en/events",
  },
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
    title: "Why live desks matter for breaking news",
    dek: "A live desk updates as facts change. A static page does not.",
    date: "2026-10-01",
    body: [
      "When a story is moving, numbers and locations change. A live desk keeps the latest in one place instead of leaving old paragraphs on the page.",
      "Check the timestamp and the source list. If both are missing, treat the page as a snapshot, not a live report.",
    ],
    tool: "/en/news",
  },
];
