import Tool from "@/components/en/EnCrypto";
import EnToolPage, { enToolMetadata } from "@/components/en/EnToolPage";

export const metadata = enToolMetadata("crypto-converter");

export default function CryptoConverterEnPage() {
  return (
    <EnToolPage slug="crypto-converter">
      <Tool />
    </EnToolPage>
  );
}
