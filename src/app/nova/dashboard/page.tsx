import NovaDashboardClient from "./NovaDashboardClient";

export default async function NovaDashboardPage(props: { searchParams: Promise<{ uid?: string }> }) {
  const searchParams = await props.searchParams;
  return <NovaDashboardClient uid={String(searchParams.uid || "")} />;
}
