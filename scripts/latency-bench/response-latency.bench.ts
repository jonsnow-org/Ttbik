// Response-latency benchmark for Nova and Sham Pro — measurement, not CI. No Studio, no token, no network.
//
// HOW TO RE-RUN (also printed at the end of the output):
//   bash scripts/latency-bench/bench.sh
//   # or: cd athar && npx jest --config ../jest.latency.config.js --rootDir .. --runInBand
//   # requires the repo's root dependencies once:  npm ci   (for @prisma/client and the app modules)
//
// What is REAL and what is SIMULATED:
//   * REAL, imported from the code under test (src/lib/coderSections.ts): novaFirstByteCap(), novaFirstByteWaitS(leftMs),
//     novaSubmitTimeoutMs(waitS), pollMs(), prefillPollMs(). The "after" column is the exact policy the Telegram loop runs;
//     the numbers cannot drift from the code because they are not copied here.
//   * SIMULATED: the answer time and the prefill time. They are inputs of a CPU Studio that is not reachable from here, and
//     they are the SAME for "before" and "after"; only the code-controlled delay differs. This proves the client-side delay,
//     not the provider's tokens/s.
//
// Sham Pro already streams (shamGenerateChatStream yields deltas), so its first word is the first delta; the table shows it
// against a non-streaming baseline. The lazy saved-skills read removes one database round-trip from tool-less steps.
import { novaFirstByteCap, novaFirstByteWaitS, novaSubmitTimeoutMs, pollMs, prefillPollMs } from "@/lib/coderSections";

declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => { toBe: (v: unknown) => void; toBeLessThan: (v: number) => void; toBeGreaterThanOrEqual: (v: number) => void };

// The production prefill poll (4000 ms) is not the test default (0), and the benchmark measures production.
if (process.env.CODER_PREFILL_POLL_MS === undefined) process.env.CODER_PREFILL_POLL_MS = "4000";

const OLD_CAP_S = 20;                                            // the constant this change replaced: Math.min(20, ...)
const oldWaitS = (leftMs: number): number => Math.max(1, Math.min(OLD_CAP_S, Math.floor((leftMs - 12000) / 1000)));

type Step = { blockedMs: number; firstWordMs: number };
/** Client side of one Nova step: the first response is held inline for min(wait, answer), then the bot polls and shows the text grown so far. */
function novaStep(answerMs: number, prefillMs: number, waitS: number): Step {
  const hold = Math.min(waitS * 1000, answerMs);
  if (answerMs <= hold) return { blockedMs: answerMs, firstWordMs: answerMs };
  let t = hold;
  t += t < prefillMs ? prefillPollMs() : pollMs();
  while (t < prefillMs) t += prefillPollMs();
  return { blockedMs: hold, firstWordMs: Math.max(Math.min(t, answerMs), hold) };
}

const pad = (s: unknown, n: number) => String(s).padStart(n);
/** Print straight to stdout: jest's console wrapper prefixes every line with a stack location, which buries a table. */
const print = (line: string) => process.stdout.write(`${line}\n`);
const pct = (before: number, after: number) => (before > 0 ? `${(((before - after) / before) * 100).toFixed(0)}%` : "0%");

describe("response latency (Nova + Sham Pro)", () => {
  it("prints the before/after numbers and checks the policy is the new one by default", () => {
    const newCap = novaFirstByteCap();
    const submit = novaSubmitTimeoutMs(newCap);
    print(`\nNova — first word (ms), same simulated answer; poll=${pollMs()}ms prefillPoll=${prefillPollMs()}ms`);
    print(`  old cap=${OLD_CAP_S}s  new cap=${newCap}s  submit floor=${submit}ms\n`);
    print("  answer   prefill |   old blocked   new blocked |  old firstWord  new firstWord | saved");
    print("  -------------------------------------------------------------------------------------------");
    for (const prefillMs of [0, 15000]) {
      print(`  -- prefill ${prefillMs} ms (cold read) --`);
      for (const answerMs of [3000, 10000, 30000, 90000, 180000]) {
        const before = novaStep(answerMs, prefillMs, oldWaitS(600000));
        const after = novaStep(answerMs, prefillMs, novaFirstByteWaitS(600000));
        print(
          `  ${pad(answerMs / 1000 + "s", 7)} ${pad(prefillMs / 1000 + "s", 7)} |` +
            `${pad(before.blockedMs, 14)} ${pad(after.blockedMs, 14)} |` +
            `${pad(before.firstWordMs, 14)} ${pad(after.firstWordMs, 14)} | ${pct(before.firstWordMs, after.firstWordMs)}`
        );
      }
    }
    const answerMs = 30000;
    const b = novaStep(answerMs, 0, oldWaitS(600000));
    const a = novaStep(answerMs, 0, novaFirstByteWaitS(600000));

    print("\nSham Pro — first word (ms): streaming (current) vs a non-streaming baseline, same simulated answer");
    print("  answer | head | streaming | non-stream | saved");
    print("  -----------------------------------------------------");
    for (const [ans, head] of [[3000, 0], [10000, 0], [30000, 0], [30000, 3400], [90000, 3400]]) {
      const stream = head + 300;
      const base = head + ans;
      print(`  ${pad(ans / 1000 + "s", 6)} | ${pad(head, 4)} | ${pad(stream, 9)} | ${pad(base, 10)} | ${pct(base, stream)}`);
    }
    print("\nSham Pro — a tool-less first step (greeting / plain answer) no longer waits on the saved-skills read");
    for (const dbMs of [15, 120]) print(`  db round-trip ~${dbMs}ms → removed from a greeting: ${dbMs}ms on the critical path`);

    print("\nكيف يعاد التشغيل: bash scripts/latency-bench/bench.sh");
    print("  (أو: cd athar && npx jest --config ../jest.latency.config.js --rootDir .. --runInBand)\n");

    // The policy must be the new one by default and must never orphan a job or cut a cold Studio.
    expect(newCap).toBe(4);
    expect(novaFirstByteWaitS(600000)).toBeLessThan(20);
    expect(submit).toBeGreaterThanOrEqual(30000);
    expect(a.firstWordMs).toBeLessThan(b.firstWordMs);
  });
});
