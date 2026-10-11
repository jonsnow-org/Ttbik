import EnToolPage, { enToolMetadata } from "@/components/en/EnToolPage";
import Tool from "@/components/en/EnAge";

export const metadata = enToolMetadata("life-counter");

export default function Page() {
  return (
    <EnToolPage slug="life-counter">
      <Tool />
    </EnToolPage>
  );
}
