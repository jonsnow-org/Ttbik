import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

const COOKIE_NAME = "ttbik_admin";

function expectedPassword(): string {
  return (process.env.ADMIN_PASSWORD || "").trim();
}

/** Server component usage — reads the same cookie the /admin dashboard sets. */
export async function isOwnerServer(): Promise<boolean> {
  const value = (await cookies()).get(COOKIE_NAME)?.value;
  const expected = expectedPassword();
  return !!value && !!expected && value === expected;
}

/** Route handler usage — reads the cookie straight off the request. */
export function isOwnerRequest(req: NextRequest): boolean {
  const value = req.cookies.get(COOKIE_NAME)?.value;
  const expected = expectedPassword();
  return !!value && !!expected && value === expected;
}
