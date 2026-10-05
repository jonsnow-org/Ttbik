import MarriagePayClient from "./MarriagePayClient";

export default async function MarriagePayPage(props: { searchParams: Promise<{ uid?: string; paid?: string }> }) {
  const searchParams = await props.searchParams;
  return <MarriagePayClient uid={String(searchParams.uid || "")} justPaid={searchParams.paid === "1"} />;
}
