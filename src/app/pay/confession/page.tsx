import ConfessionPayClient from "./ConfessionPayClient";

export default async function ConfessionPayPage(props: { searchParams: Promise<{ uid?: string; paid?: string }> }) {
  const searchParams = await props.searchParams;
  return <ConfessionPayClient uid={String(searchParams.uid || "")} justPaid={searchParams.paid === "1"} />;
}
