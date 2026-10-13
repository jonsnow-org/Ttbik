import EnToolPage, { enToolMetadata } from "@/components/en/EnToolPage";
import Tool from "@/components/en/EnFancyText";

export const metadata = enToolMetadata("fancy-text");

export default function Page() {
  return (
    <EnToolPage slug="fancy-text">
      <Tool />
    </EnToolPage>
  );
}
