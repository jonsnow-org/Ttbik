import NovaConnectionsClient from "./NovaConnectionsClient";

export default async function NovaConnectionsPage(props: { searchParams: Promise<{ uid?: string }> }) {
  const searchParams = await props.searchParams;
  return <NovaConnectionsClient uid={String(searchParams.uid || "")} />;
}
