import ExploreMore from "@/components/ExploreMore";
import ToolSupportBar from "@/components/ToolSupportBar";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <ToolSupportBar />
      <ExploreMore from="tools" />
    </>
  );
}
