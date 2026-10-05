import PayClient from "./PayClient";

export default async function PayPage(props: { searchParams: Promise<{ uid?: string; paid?: string }> }) {
  const searchParams = await props.searchParams;
  return <PayClient uid={String(searchParams.uid || "")} justPaid={searchParams.paid === "1"} />;
}
