import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import Script from "next/script";
import { appPalette, validateAppConfig } from "@/lib/hub/appConfig";
import { bumpViews, getApp } from "@/lib/hub/hubDb";
import MiniAppExperience from "./MiniAppExperience";
import "./mini-app.css";

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { slug } = await props.params;
  const app = await getApp(slug).catch(() => null);
  return {
    title: app ? app.config.title + " | صُنع بشام AI" : "تطبيق غير موجود",
    robots: { index: false },
  };
}

export default async function MiniAppPage(props: Props) {
  const { slug } = await props.params;
  const row = await getApp(slug).catch(() => null);
  if (!row) notFound();
  const validated = validateAppConfig(row.config);
  if (!validated.ok) notFound();
  void bumpViews(slug);

  return (
    <>
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" />
      <MiniAppExperience config={validated.config} palette={appPalette(validated.config.color)} views={row.views} />
    </>
  );
}
