import EnToolPage, { enToolMetadata } from "@/components/en/EnToolPage";
import Tool from "@/components/en/EnBmi";

export const metadata = enToolMetadata("bmi-calculator");

export default function Page() {
  return (
    <EnToolPage slug="bmi-calculator">
      <Tool />
    </EnToolPage>
  );
}
