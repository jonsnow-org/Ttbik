import UrlShortener from "@/app/free-tools/url-shortener/UrlShortener";
import EnToolPage, { enToolMetadata } from "@/components/en/EnToolPage";

export const metadata = enToolMetadata("url-shortener");

export default function UrlShortenerEnPage() {
  return (
    <EnToolPage slug="url-shortener">
      <UrlShortener lang="en" />
    </EnToolPage>
  );
}
