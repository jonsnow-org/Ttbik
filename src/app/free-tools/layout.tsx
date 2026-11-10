import ExploreMore from "@/components/ExploreMore";
import ToolSupportBar from "@/components/ToolSupportBar";
import ToolSponsorAuto from "@/components/ToolSponsorAuto";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ToolSponsorAuto />
      {children}
      <ToolSupportBar />
      <ExploreMore from="tools" />
    </>
  );
}
