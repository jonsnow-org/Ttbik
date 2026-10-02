import { redirect } from "next/navigation";

/** Removed from free tools — feature was intended for mini-app only. */
export default function RemovedToolRedirect() {
  redirect("/free-tools");
}
