/** A continuation handoff must be confirmed; a silent HTTP/network failure otherwise leaves the progress card stuck forever. */
export type ShamContinuationPostResult =
  | { ok: true }
  | { ok: false; uncertain: boolean; reason: string };

export async function postShamContinuation(
  url: string,
  body: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = 5000,
): Promise<ShamContinuationPostResult> {
  try {
    const response = await fetcher(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(Math.max(1, timeoutMs)),
      cache: "no-store",
    });
    if (response.status === 202) return { ok: true };
    return { ok: false, uncertain: false, reason: `HTTP ${response.status}` };
  } catch (e) {
    return {
      ok: false,
      uncertain: true,
      reason: String((e as Error)?.message || e).slice(0, 140),
    };
  }
}
