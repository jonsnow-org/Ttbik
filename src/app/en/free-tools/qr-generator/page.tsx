import QrGenerator from "@/app/free-tools/qr-generator/QrGenerator";
import EnToolPage, { enToolMetadata } from "@/components/en/EnToolPage";

export const metadata = enToolMetadata("qr-generator");

export default function QrGeneratorEnPage() {
  return (
    <EnToolPage slug="qr-generator">
      <QrGenerator lang="en" />
    </EnToolPage>
  );
}
