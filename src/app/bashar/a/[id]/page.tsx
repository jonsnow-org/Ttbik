import { redirect } from "next/navigation";

// Old answer links (first version) now open the question page, which shows
// every answer and lets the visitor answer too.
export default async function OldAnswerLink(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  redirect(`/bashar/q/${params.id}`);
}
