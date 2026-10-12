import EnToolPage, { enToolMetadata } from "@/components/en/EnToolPage";
import Tool from "@/components/en/EnDateDiff";

export const metadata = enToolMetadata("date-difference");

export default function Page() {
  return (
    <EnToolPage slug="date-difference">
      <Tool />
    </EnToolPage>
  );
}
