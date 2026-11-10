/** Same rule as the other cron routes: `Authorization: Bearer $CRON_SECRET`, and no secret configured = locked. */
export function isCronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && req.headers.get("authorization") === `Bearer ${secret}`;
}
