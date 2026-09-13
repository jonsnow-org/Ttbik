import NovaConnectionsClient from "./NovaConnectionsClient";

export default function NovaConnectionsPage({ searchParams }: { searchParams: { uid?: string } }) {
  return <NovaConnectionsClient uid={String(searchParams.uid || "")} />;
}
