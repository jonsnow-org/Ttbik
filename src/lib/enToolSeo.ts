// English copy for the /en/free-tools pages (title, intro, explanation, FAQ).
// Plain factual text: read by people and quoted by search/answer engines.
export type EnTool = {
  slug: string;
  ar?: string; // matching Arabic tool slug (for hreflang)
  title: string;
  h1: string;
  desc: string;
  intro: string;
  about: string[];
  faq: { q: string; a: string }[];
};

export const EN_TOOL_PAGES: EnTool[] = [
  {
    slug: "bmi-calculator", ar: "bmi-calculator",
    title: "BMI Calculator (Metric & Imperial) — Free, No Signup",
    h1: "BMI calculator",
    desc: "Calculate body mass index from height and weight in kg/cm or lb/ft. See your category and the healthy weight range for your height. Runs in your browser.",
    intro: "Enter your weight and height to get your body mass index, its category and the weight range that counts as healthy for your height.",
    about: [
      "Body mass index (BMI) is weight in kilograms divided by height in metres squared. For adults the World Health Organization defines under 18.5 as underweight, 18.5 to 24.9 as healthy weight, 25 to 29.9 as overweight and 30 or more as obesity.",
      "BMI is a quick screening number, not a diagnosis. It cannot tell muscle from fat, so it can mislead for athletes, older adults and during pregnancy, and it is not used for children. Talk to a doctor for a proper assessment. All calculation happens in your browser; nothing is sent to a server.",
    ],
    faq: [
      { q: "What is a healthy BMI?", a: "For adults a BMI between 18.5 and 24.9 is considered a healthy weight by the WHO." },
      { q: "How do I calculate BMI in pounds and feet?", a: "Switch to Imperial: BMI = 703 × weight in pounds ÷ height in inches squared. The calculator converts for you." },
      { q: "Is BMI accurate for athletes?", a: "Not always. Muscle weighs more than fat, so muscular people can have a high BMI without excess body fat." },
    ],
  },
  {
    slug: "vat-calculator", ar: "vat-calculator",
    title: "VAT Calculator — Add or Remove VAT / GST / Sales Tax",
    h1: "VAT calculator",
    desc: "Add VAT to a price or remove it from a VAT-inclusive total. Works with any rate: UK, EU, Gulf, Canada GST and more. Free and instant.",
    intro: "Choose whether to add or remove VAT, enter the amount and the tax rate, and see net, VAT and gross at once.",
    about: [
      "To add VAT multiply the net price by (1 + rate). To remove VAT from a gross price divide by (1 + rate). For example, at 20% a net price of 100 becomes 120, and a gross price of 120 contains 20 of VAT.",
      "Rates differ by country and by product, so enter the rate that applies to you. This calculator also works for GST and simple sales-tax maths. Nothing you type leaves your browser.",
    ],
    faq: [
      { q: "How do I remove VAT from a price?", a: "Divide the VAT-inclusive price by 1 plus the rate. At 20% divide by 1.2." },
      { q: "Is VAT the same as sales tax?", a: "No. VAT is collected at each stage of the supply chain; US sales tax is charged once at the final sale. The arithmetic for a single price is similar." },
      { q: "What VAT rate should I use?", a: "Use the rate that applies to your country and product, for example 20% in the UK standard rate, 19% in Germany, 15% in Saudi Arabia, 5% in the UAE." },
    ],
  },
  {
    slug: "profit-margin", ar: "profit-margin",
    title: "Profit Margin & Markup Calculator with Break-Even",
    h1: "Profit margin calculator",
    desc: "Turn cost and selling price into profit, margin, markup and break-even units. Free and runs in your browser.",
    intro: "Enter your unit cost and selling price (and optional fixed costs) to see profit, margin, markup and how many units you must sell to break even.",
    about: [
      "Profit margin is profit divided by selling price. Markup is profit divided by cost. They are often confused: a product costing 50 and sold at 100 has a 100% markup but only a 50% margin.",
      "Break-even units equal fixed costs divided by profit per unit. Selling fewer than that loses money; selling more earns profit. Use it to test a price before you launch.",
    ],
    faq: [
      { q: "What is the difference between margin and markup?", a: "Margin is measured against the selling price, markup against the cost. Margin is always smaller than markup for the same product." },
      { q: "How do I calculate break-even?", a: "Divide total fixed costs by profit per unit (price minus unit cost)." },
    ],
  },
  {
    slug: "life-counter", ar: "life-counter",
    title: "Age Calculator — Exact Age in Years, Months and Days",
    h1: "Age calculator",
    desc: "Find your exact age in years, months and days, total days lived and days until your next birthday. Free, no signup.",
    intro: "Pick your date of birth to see your exact age, how many days you have lived and how long until your next birthday.",
    about: [
      "The calculator subtracts your birth date from today, borrowing days from the previous month when needed, so the result matches how most people count age.",
      "It also shows the day of the week you were born on and the countdown to your next birthday. The date never leaves your browser.",
    ],
    faq: [
      { q: "How is exact age calculated?", a: "Years, months and days are counted from your birth date to today, adjusting for month lengths." },
      { q: "Does it handle leap years?", a: "Yes, the total days count uses real calendar dates including leap days." },
    ],
  },
  {
    slug: "whatsapp-link", ar: "whatsapp-link",
    title: "WhatsApp Link Generator — Click-to-Chat with Pre-filled Message",
    h1: "WhatsApp link generator",
    desc: "Create a wa.me click-to-chat link with a pre-filled message for your store, bio or ads. Free and instant.",
    intro: "Enter a phone number with country code and an optional message to get a link that opens a WhatsApp chat in one tap.",
    about: [
      "A WhatsApp click-to-chat link looks like https://wa.me/14155550123?text=Hello. Anyone who taps it opens a chat with that number, with your message ready to send.",
      "Use digits only and include the country code without a plus sign or leading zeros. Add the link to your Instagram bio, website button, email signature or QR code.",
    ],
    faq: [
      { q: "Do I need a WhatsApp Business account?", a: "No. The link works with any WhatsApp number." },
      { q: "How do I format the number?", a: "Country code followed by the number, digits only. For a US number 415 555 0123 use 14155550123." },
    ],
  },
  {
    slug: "percentage-calculator", ar: "percentage-calculator",
    title: "Percentage Calculator — Percent Of, Change and Discount",
    h1: "Percentage calculator",
    desc: "Four percentage calculators in one page: X% of a number, what percent a part is, percent change, and price after discount.",
    intro: "Type your numbers and get the answer immediately; no button to press.",
    about: [
      "X% of Y equals Y × X ÷ 100. Percent change equals (new − old) ÷ old × 100. A discounted price equals the original × (1 − discount ÷ 100).",
      "Example: 15% of 200 is 30; going from 100 to 130 is a 30% increase; a 250 item at 20% off costs 200.",
    ],
    faq: [
      { q: "How do I calculate a percentage of a number?", a: "Multiply the number by the percentage and divide by 100." },
      { q: "How do I calculate percent increase?", a: "Subtract the old value from the new one, divide by the old value, and multiply by 100." },
    ],
  },
  {
    slug: "date-difference", ar: "date-difference",
    title: "Date Difference Calculator — Days Between Two Dates",
    h1: "Days between two dates",
    desc: "Count the years, months, weeks and days between two dates, or add days to a date. Free date calculator.",
    intro: "Choose two dates to see the exact gap, or add and subtract days from a date for deadlines and countdowns.",
    about: [
      "The calculator reports the gap in years, months and days and the total in days and weeks. It uses calendar dates, so month lengths and leap years are handled.",
      "Use it for contract periods, notice periods, warranty deadlines, trip countdowns or the date that falls 90 days after an event.",
    ],
    faq: [
      { q: "Are both end dates counted?", a: "The result counts the days between the dates; add one day if you want to include both the first and the last day." },
      { q: "Can I find the date after a number of days?", a: "Yes, use the second calculator and enter a positive number to go forward or a negative one to go back." },
    ],
  },
  {
    slug: "pregnancy-calculator", ar: "pregnancy-calculator",
    title: "Pregnancy Due Date Calculator — From Last Period",
    h1: "Pregnancy due date calculator",
    desc: "Estimate your due date, current pregnancy week and trimester start dates from the first day of your last period.",
    intro: "Enter the first day of your last period (and your cycle length if it is not 28 days) to get an estimated due date and pregnancy week.",
    about: [
      "The calculator uses Naegele's rule: due date = first day of last period + 280 days (40 weeks), adjusted if your cycle is longer or shorter than 28 days.",
      "Only a small share of babies arrive on the exact estimated date. An early ultrasound and your midwife or doctor provide the most reliable dating. Nothing you enter is stored or sent.",
    ],
    faq: [
      { q: "How is the due date calculated?", a: "By adding 280 days to the first day of the last menstrual period, with an adjustment for cycle length." },
      { q: "How accurate is it?", a: "It is an estimate; most babies are born within two weeks before or after it." },
    ],
  },
  {
    slug: "fancy-text", ar: "name-decorator",
    title: "Fancy Text Generator — Cool Fonts for Names and Bios (Copy & Paste)",
    h1: "Fancy text generator",
    desc: "Turn plain text into bold, script, gothic, circled and gamer-tag styles you can copy and paste into Instagram, TikTok, Discord and games.",
    intro: "Type a name or bio line and tap any style to copy it.",
    about: [
      "These styles are made from Unicode symbols, so they paste almost anywhere without installing fonts: Instagram bios, TikTok names, Discord nicknames, Steam and gaming profiles.",
      "Some platforms block certain symbols or screen readers may read them poorly, so use them for decoration and not for text people must be able to search or read aloud.",
    ],
    faq: [
      { q: "How do I use these fonts on Instagram?", a: "Tap a style to copy it, then paste it into your name, bio or caption." },
      { q: "Why does a symbol show as a square?", a: "The device or app lacks a glyph for that character. Try a different style." },
    ],
  },

  {
    slug: "qr-generator", ar: "qr-generator",
    title: "Free QR Code Generator — Custom Colors and PNG Download",
    h1: "Free QR code generator",
    desc: "Create a QR code for a URL or text, customize its size and colors, and download a PNG. Free and generated in your browser.",
    intro: "Enter a website address or any text, choose a size and color combination, then download a QR image you can use on a screen or in print.",
    about: [
      "A QR code stores a short piece of information in a two-dimensional pattern. A phone camera can scan it to open a website, read text, or access other supported data without typing the content manually.",
      "This generator creates the code in your browser and lets you adjust its dimensions and foreground and background colors before downloading a PNG. For reliable scanning, keep strong contrast, leave a clear margin around the code, and test the downloaded image with more than one phone before printing it.",
    ],
    faq: [
      { q: "Can I make a QR code for Arabic text?", a: "Yes. The QR code stores text rather than drawing Arabic letters as an image, so compatible scanner apps can read Arabic content." },
      { q: "Will the QR code expire?", a: "A static QR code does not expire on its own. If it contains a web link, the destination must continue to work." },
      { q: "Why will some phones not scan my QR code?", a: "Low contrast, a missing quiet margin, very small print size, or a damaged image can make scanning difficult. Use a dark code on a light background and test it before distribution." },
    ],
  },
  {
    slug: "url-shortener", ar: "url-shortener",
    title: "Free URL Shortener with a Click Counter",
    h1: "Free URL shortener",
    desc: "Create a shorter link for sharing and track its click count. No account is required.",
    intro: "Paste a long web address to create a compact link that is easier to share in messages, profiles, printed material, and social posts.",
    about: [
      "A short link redirects visitors to the original destination. The short-link service must retain the destination and record visits to provide the redirect and click counter, so do not use it for private or confidential URLs.",
      "Before sharing a shortened link, open it yourself and confirm that it reaches the intended website. A short link does not make the destination safer; only open links from sources you trust.",
    ],
    faq: [
      { q: "Does a shortened link keep working forever?", a: "It remains available while the short-link record and the destination are active. Do not use a short link as the only copy of an important address." },
      { q: "Can I see how many times a link was clicked?", a: "The tool displays a click count for links it creates. A click count is a visit metric, not a guarantee that a person read the destination page." },
      { q: "Should I shorten a private or sensitive URL?", a: "No. The short-link service needs to store the destination to redirect visitors. Avoid shortening links that contain passwords, private access tokens, or confidential information." },
    ],
  },
  {
    slug: "talking-photo", ar: "talking-photo",
    title: "Talking Photo Maker — Make a Picture Speak with Your Voice",
    h1: "Make a picture speak",
    desc: "Add a voice recording to a portrait or drawing and create a short speaking-photo video in your browser.",
    intro: "Choose a picture, add an audio file or record your voice, and create a short video in which the picture moves with the sound. Processing happens in your browser.",
    about: [
      "A talking-photo effect combines a still image with audio and applies visible facial movement to make the picture appear to speak. This tool performs its visual processing in the browser rather than uploading the selected media to a remote rendering service.",
      "The result is an animation effect, not proof that the pictured person said the words. Use images you own or have permission to use, disclose edits when appropriate, and never present an edited clip as authentic evidence. Export formats and processing speed depend on browser support and device performance.",
    ],
    faq: [
      { q: "Are my photo and voice uploaded to a server?", a: "The tool is designed to process the selected media in your browser. The tool page does not need to upload the source picture or voice to render the effect." },
      { q: "Can I use a drawing or fictional character?", a: "Yes. You can use a portrait, drawing, or fictional character, provided you have the rights to use the image." },
      { q: "Why can video export take a long time?", a: "Rendering and recording depend on the size of the image, audio duration, browser capabilities, and available device resources. Shorter clips and moderate image dimensions are usually easier to process." },
    ],
  },
  {
    slug: "image-optimizer", ar: "image-optimizer",
    title: "Free Image Compressor and Converter — WebP, JPEG, PNG",
    h1: "Free image compressor",
    desc: "Resize and compress images, then export WebP, JPEG, or PNG directly in your browser without uploading the source image.",
    intro: "Select an image, choose an output format and quality, and download a smaller copy for websites, shops, or social media.",
    about: [
      "Image optimization reduces file size or dimensions so pages and uploads can load faster. The best settings depend on the image: photographs often compress well as JPEG or WebP, while graphics that need transparency should use PNG or a supported WebP setting.",
      "This tool uses browser image and canvas capabilities to process the selected file locally. A lower quality setting can reduce file size but may introduce visible artifacts, so compare the preview before saving. The original file is not overwritten.",
    ],
    faq: [
      { q: "Which format should I choose?", a: "WebP often provides a good balance for web images, JPEG is widely supported for photographs, and PNG is useful when lossless detail or transparency is needed." },
      { q: "Does compression always make an image smaller?", a: "Not always. A small or already-optimized image may not shrink, and converting formats can sometimes increase file size. Compare the output size before using it." },
      { q: "Is my original image sent to the website?", a: "The image conversion is performed in your browser. The source image is not uploaded to the site's server by this tool." },
    ],
  },
  {
    slug: "invoice-generator", ar: "invoice-generator",
    title: "Free Invoice Generator — Create and Print an Invoice",
    h1: "Invoice generator",
    desc: "Create a simple invoice in your browser, add line items and totals, and print or save the result as a PDF. No account required.",
    intro: "Prepare a clear invoice by entering the seller and customer details, adding the items and amounts, and reviewing the totals before printing.",
    about: [
      "An invoice records what was supplied, who supplied it, who should pay, and the amount due. A useful invoice normally identifies both parties, includes an issue date and a unique reference, describes each item, and shows any tax or additional charge clearly.",
      "This browser-based generator helps prepare a simple document for review and printing. It does not submit invoices to a tax authority, verify tax compliance, or replace accounting advice. Check local invoicing rules and required fields before issuing a document to a customer.",
    ],
    faq: [
      { q: "Can I save the invoice as a PDF?", a: "Use the browser's print dialog and choose its Save as PDF option when available." },
      { q: "Does the tool send my customer details to a server?", a: "The invoice is prepared in the browser; avoid sharing the generated document publicly because it may contain personal or business information." },
      { q: "Is this invoice valid for every country?", a: "Invoice requirements vary by country and business type. Review local tax and record-keeping requirements before using the document as an official invoice." },
    ],
  },
  {
    slug: "cv-generator", ar: "cv-generator",
    title: "Free CV Generator — Build a One-Page Resume",
    h1: "CV generator",
    desc: "Build a clear one-page CV in your browser and print or save it as a PDF. No account required.",
    intro: "Add your contact details, profile, experience, education, and skills to create a structured CV that you can review and export.",
    about: [
      "A CV should make relevant experience easy to scan. Keep the most relevant information near the top, use consistent dates and job titles, and describe achievements with specific outcomes when you can support them.",
      "This tool helps arrange your information into a one-page document in the browser. Review spelling, contact details, dates, and formatting before sending it to an employer. Tailor the final version to the role rather than sending the same document for every application.",
    ],
    faq: [
      { q: "Can I download my CV as a PDF?", a: "Use the browser print dialog and select Save as PDF to keep a shareable copy." },
      { q: "Should my CV always fit on one page?", a: "A concise one-page CV can work well for early-career applicants, but relevant experience should not be removed solely to meet a page limit." },
      { q: "Should I include a photo or personal details?", a: "Requirements differ by country and industry. Include only information that is appropriate for the role and local hiring practices." },
    ],
  },
  {
    slug: "crypto-converter", ar: "crypto-converter",
    title: "Crypto Converter — Convert TON, BTC, ETH and USDT",
    h1: "Cryptocurrency converter",
    desc: "Convert supported cryptocurrency amounts using the rates displayed by the tool. Free to use, with no account required.",
    intro: "Choose the source and target currencies, enter an amount, and view the equivalent using the latest rate available to the converter.",
    about: [
      "A cryptocurrency converter calculates an indicative value by multiplying an amount by a displayed exchange rate. Market prices can change quickly, and rates can differ between exchanges, trading pairs, network fees, and the final execution price.",
      "Use the result as a reference calculation only. It is not an offer to buy or sell cryptocurrency, a guaranteed quote, or a record of a completed transaction. Confirm the live rate and all fees on the service you intend to use before making a transfer or trade.",
    ],
    faq: [
      { q: "Is the displayed conversion price guaranteed?", a: "No. It is an indicative conversion based on the rate returned to the tool and may differ from an exchange's executable price." },
      { q: "Why might the value change?", a: "Crypto prices fluctuate continuously, and data providers may refresh at different intervals. The rate can also differ between exchanges and currency pairs." },
      { q: "Does the converter execute a trade?", a: "No. It calculates an equivalent value only. It does not place orders, transfer assets, or connect to your wallet." },
    ],
  },

];
