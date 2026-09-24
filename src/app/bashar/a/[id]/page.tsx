import { redirect } from "next/navigation";

// Old answer links (first version) now open the question page, which shows
// every answer and lets the visitor answer too.
export default function OldAnswerLink({ params }: { params: { id: string } }) {
  redirect(`/bashar/q/${params.id}`);
}
