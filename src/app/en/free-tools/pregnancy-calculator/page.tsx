import EnToolPage, { enToolMetadata } from "@/components/en/EnToolPage";
import Tool from "@/components/en/EnPregnancy";

export const metadata = enToolMetadata("pregnancy-calculator");

export default function Page() {
  return (
    <EnToolPage slug="pregnancy-calculator">
      <Tool />
    </EnToolPage>
  );
}
