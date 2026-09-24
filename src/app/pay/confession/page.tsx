import ConfessionPayClient from "./ConfessionPayClient";

export default function ConfessionPayPage({ searchParams }: { searchParams: { uid?: string; paid?: string } }) {
  return <ConfessionPayClient uid={String(searchParams.uid || "")} justPaid={searchParams.paid === "1"} />;
}
