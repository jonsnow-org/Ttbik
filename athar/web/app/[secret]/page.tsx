import { notFound } from "next/navigation";
import AdminPanel from "@/components/AdminPanel";

// The management panel lives at a secret address that only the owner receives. Any other address is an ordinary 404,
// so strangers cannot even tell a panel exists. Even with the address, nothing works without the management wallet's signature.
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ secret: string }> }) {
  const secret = process.env.ATHAR_ADMIN_PATH || "";
  const given = (await params).secret;
  if (!secret || given !== secret) notFound();
  return <AdminPanel />;
}
