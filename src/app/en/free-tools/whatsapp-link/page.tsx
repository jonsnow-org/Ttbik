import EnToolPage, { enToolMetadata } from "@/components/en/EnToolPage";
import Tool from "@/components/en/EnWhatsapp";

export const metadata = enToolMetadata("whatsapp-link");

export default function Page() {
  return (
    <EnToolPage slug="whatsapp-link">
      <Tool />
    </EnToolPage>
  );
}
