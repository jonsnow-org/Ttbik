import ImageOptimizer from "@/app/free-tools/image-optimizer/ImageOptimizer";
import EnToolPage, { enToolMetadata } from "@/components/en/EnToolPage";

export const metadata = enToolMetadata("image-optimizer");

export default function ImageOptimizerEnPage() {
  return (
    <EnToolPage slug="image-optimizer">
      <ImageOptimizer lang="en" />
    </EnToolPage>
  );
}
