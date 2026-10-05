import JobsPayClient from "./JobsPayClient";

export default async function JobsPayPage(props: { searchParams: Promise<{ uid?: string; paid?: string }> }) {
  const searchParams = await props.searchParams;
  return <JobsPayClient uid={String(searchParams.uid || "")} justPaid={searchParams.paid === "1"} />;
}
