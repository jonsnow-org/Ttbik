import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { Address } from "@ton/core";
import { getAdmin } from "@/lib/config";
export const dynamic = "force-dynamic";

// The very first connection of the management wallet fixes it for good: its PUBLIC address is written once to the data folder.
// The collection's address is derived from it, so it can never change afterwards (a second, different address is refused).
// Only the holder of the secret panel address can call this.
const deny = (req: Request) => { const s = process.env.ATHAR_ADMIN_PATH || ""; return !s || req.headers.get("x-athar-adm") !== s; };
export async function POST(req: Request) {
  if (deny(req)) return new Response("Not Found", { status: 404 });
  const b = await req.json().catch(() => null);
  let addr: Address;
  try { addr = Address.parse(String(b?.address || "")); } catch { return NextResponse.json({ error: "bad address" }, { status: 400 }); }
  const cur = getAdmin();
  if (cur) {
    let same = false; try { same = Address.parse(cur).equals(addr); } catch { /* corrupt value counts as different */ }
    return same ? NextResponse.json({ ok: true, already: true }) : NextResponse.json({ error: "another management wallet is already fixed" }, { status: 409 });
  }
  const dir = process.env.ATHAR_DATA_DIR || path.join(process.cwd(), "data");
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, "admin.txt"), tmp = f + ".tmp";
  fs.writeFileSync(tmp, addr.toString({ bounceable: false }));
  fs.renameSync(tmp, f);
  return NextResponse.json({ ok: true });
}
