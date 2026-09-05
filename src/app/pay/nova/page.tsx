import NovaPayClient from "./NovaPayClient";

export default function NovaPayPage({ searchParams }: { searchParams: { uid?: string; paid?: string } }) {
  return <NovaPayClient uid={String(searchParams.uid || "")} justPaid={searchParams.paid === "1"} />;
}
