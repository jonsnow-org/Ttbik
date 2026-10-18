import type { Metadata } from "next";

// The root metadata is Arabic ("%s | شام AI", Arabic keywords/OG locale). The
// English desk overrides the title template, keywords and OG locale so no
// Arabic leaks into English search results or share cards.
export const metadata: Metadata = {
  title: { template: "%s | Sham AI", default: "Sham AI English: free tools, guides and live headlines" },
  keywords: ["free online tools", "calculators", "QR code generator", "BMI calculator", "VAT calculator", "invoice generator", "live headlines", "global markets"],
  openGraph: { locale: "en_US", siteName: "Sham AI" },
};

export default function EnLayout({ children }: { children: React.ReactNode }) {
  return children;
}
