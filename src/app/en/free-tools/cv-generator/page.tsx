import Tool from "@/components/en/EnCv";
import EnToolPage, { enToolMetadata } from "@/components/en/EnToolPage";

export const metadata = enToolMetadata("cv-generator");

export default function CvGeneratorEnPage() {
  return (
    <EnToolPage slug="cv-generator">
      <Tool />
    </EnToolPage>
  );
}
