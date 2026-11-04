import Tool from "@/components/en/EnInvoice";
import EnToolPage, { enToolMetadata } from "@/components/en/EnToolPage";

export const metadata = enToolMetadata("invoice-generator");

export default function InvoiceGeneratorEnPage() {
  return (
    <EnToolPage slug="invoice-generator">
      <Tool />
    </EnToolPage>
  );
}
