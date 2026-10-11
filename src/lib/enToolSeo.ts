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
];
