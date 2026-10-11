import EnToolPage, { enToolMetadata } from "@/components/en/EnToolPage";
import Tool from "@/components/en/EnProfit";

export const metadata = enToolMetadata("profit-margin");

export default function Page() {
  return (
    <EnToolPage slug="profit-margin">
      <Tool />
    </EnToolPage>
  );
}
