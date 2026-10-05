import { supabasePublic } from "@/lib/supabase";
import StatusPoller from "./StatusPoller";

async function getStatus(code: string) {
  const db = supabasePublic();
  const { data } = await db.rpc("get_order_public_status", { p_order_code: code });
  const row = Array.isArray(data) ? data[0] : data;
  return row ?? null;
}

export default async function OrderStatusPage(props: { params: Promise<{ code: string }> }) {
  const params = await props.params;
  const initial = await getStatus(params.code);

  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <h1 className="mb-6 text-center text-xl font-extrabold text-slate-900">حالة طلبك</h1>
      <StatusPoller code={params.code} initial={initial} />
    </div>
  );
}
