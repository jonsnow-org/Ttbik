import EnToolPage, { enToolMetadata } from "@/components/en/EnToolPage";
import Tool from "@/components/en/EnVat";

export const metadata = enToolMetadata("vat-calculator");

export default function Page() {
  return (
    <EnToolPage slug="vat-calculator">
      <Tool />
    </EnToolPage>
  );
}
