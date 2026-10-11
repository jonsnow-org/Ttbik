import EnToolPage, { enToolMetadata } from "@/components/en/EnToolPage";
import Tool from "@/components/en/EnPercent";

export const metadata = enToolMetadata("percentage-calculator");

export default function Page() {
  return (
    <EnToolPage slug="percentage-calculator">
      <Tool />
    </EnToolPage>
  );
}
