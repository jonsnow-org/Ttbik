import NovaDashboardClient from "./NovaDashboardClient";

export default function NovaDashboardPage({ searchParams }: { searchParams: { uid?: string } }) {
  return <NovaDashboardClient uid={String(searchParams.uid || "")} />;
}
