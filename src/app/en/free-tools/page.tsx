import type { Metadata } from "next";
import Link from "next/link";
import EnglishDeskNav from "@/components/EnglishDeskNav";
import { SITE_URL } from "@/lib/siteUrl";

export const metadata: Metadata = {
  title: { absolute: "Free Browser Tools — No Signup | Sham AI" },
  description: "English browser tools for QR codes, short links, and image size checks. No account, no upload required.",
  alternates: { canonical: `${SITE_URL}/en/free-tools`, languages: { en: `${SITE_URL}/en/free-tools` } },
};

const TOOLS = [
  ["/en/free-tools/qr-generator", "QR code generator", "Make a code for a link or a Wi-Fi name in the browser."],
  ["/en/free-tools/url-shortener", "URL shortener", "Turn a long link into a short one you can share."],
  ["/en/free-tools/image-optimizer", "Image optimizer", "Reduce an image before you publish a page."],
];

export default function EnglishTools() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8" lang="en">
      <EnglishDeskNav />
      <h1 className="mb-2 text-2xl font-extrabold">Tools</h1>
      <p className="mb-6 text-sm leading-7 text-slate-600">Browser tools for English searches. Each one runs without an account.</p>
      <div className="grid gap-3">
        {TOOLS.map(([href, title, text]) => (
          <Link key={href} href={href} className="rounded-3xl border border-slate-200 p-4">
            <h2 className="text-lg font-bold">{title}</h2>
            <p className="mt-1 text-sm text-slate-700">{text}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
