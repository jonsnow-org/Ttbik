import ExploreMore from "@/components/ExploreMore";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <ExploreMore from="tools" />
    </>
  );
}
