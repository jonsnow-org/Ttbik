#!/usr/bin/env node
// Response-latency benchmark for Nova and Sham Pro — one command, no Studio, no token, no network.
//
//   node scripts/latency-bench/response-latency.mjs
//   CODER_FIRST_BYTE_WAIT_S=4 node scripts/latency-bench/response-latency.mjs
//
// What is REAL here and what is SIMULATED:
//   * REAL: the client-side timing rules of the code under test. The Nova numbers use the same constants the bot uses
//     (src/lib/coderSections.ts): the first response is held inline for `waitS` s, then the bot polls (`pollMs()` = 1200 ms,
//     `CODER_PREFILL_POLL_MS` = 4000 ms while the Studio is still reading). The change measured is the cap on `waitS`
//     (was 20 s, now CODER_FIRST_BYTE_WAIT_S, default 4 s).
//   * SIMULATED: the answer time and the prefill time. They are inputs of a CPU Studio that is not reachable from here, so they
//     are the SAME for the "before" and the "after" run; only the code-controlled delay changes. This script therefore proves
//     the client-side improvement, not the provider's tokens/s.
//
// Sham Pro already streams (shamGenerateChatStream yields deltas), so its first word is the first delta, not the whole answer.
// This script prints that against a non-streaming baseline to show where the time actually goes, and how much of the pre-model
// path (the awaited saved-skills database read) the current code removes for a tool-less first step.

const POLL_MS = Math.max(800, Number(process.env.CODER_POLL_MS) || 1200);
const PREFILL_POLL_MS = Math.max(POLL_MS, Number(process.env.CODER_PREFILL_POLL_MS) || 4000);
const OLD_CAP_S = 20;                                                 // the previous code: Math.min(20, ...)
const NEW_CAP_S = Math.max(1, Math.min(20, Number(process.env.CODER_FIRST_BYTE_WAIT_S) || 4));

/**
 * One Nova step, client side. The Studio holds the first response inline for min(cap, answer) and then returns either the
 * finished answer (`done`) or a job (`pending`) that keeps generating. The bot cannot see any text until that call returns;
 * after it returns, it polls and each poll shows the text grown so far.
 */
function novaStep({ answerMs, prefillMs = 0, capS }) {
  const hold = Math.min(capS * 1000, answerMs);                        // time the bot is blocked on the first HTTP call
  if (answerMs <= hold) return { blockedMs: answerMs, firstWordMs: answerMs, mode: "inline done" };
  let t = hold;                                                        // first poll only after the inline call returns
  t += t < prefillMs ? PREFILL_POLL_MS : POLL_MS;
  while (t < prefillMs) t += PREFILL_POLL_MS;                          // still reading: the slower prefill poll
  const firstWordMs = Math.max(Math.min(t, answerMs), hold);
  return { blockedMs: hold, firstWordMs, mode: "pending → poll (streams)" };
}

/** Sham Pro, client side. Stream = the answer's first delta; baseline = the whole answer before anything is shown. */
function shamReply({ answerMs, headMs = 0, firstDeltaMs = 300, stream }) {
  return stream ? headMs + firstDeltaMs : headMs + answerMs;
}

const pad = (s, n) => String(s).padStart(n);
const pct = (before, after) => (before > 0 ? `${(((before - after) / before) * 100).toFixed(0)}%` : "0%");

console.log("Nova — first word the user can see (ms), same simulated answer before/after the waitS cap");
console.log(`  poll=${POLL_MS}ms prefillPoll=${PREFILL_POLL_MS}ms  old cap=${OLD_CAP_S}s  new cap=${NEW_CAP_S}s\n`);
console.log("  answer   prefill |    old blocked    new blocked |   old firstWord   new firstWord |  saved");
console.log("  ----------------------------------------------------------------------------------------------");
const answers = [3000, 10000, 30000, 90000, 180000];
const prefills = [0, 15000];
for (const prefillMs of prefills) {
  console.log(`  -- prefill ${prefillMs} ms (cold read) --`);
  for (const answerMs of answers) {
    const before = novaStep({ answerMs, prefillMs, capS: OLD_CAP_S });
    const after = novaStep({ answerMs, prefillMs, capS: NEW_CAP_S });
    console.log(
      `  ${pad(answerMs / 1000 + "s", 7)} ${pad(prefillMs / 1000 + "s", 7)} |` +
      `${pad(before.blockedMs, 15)} ${pad(after.blockedMs, 15)} |` +
      `${pad(before.firstWordMs, 16)} ${pad(after.firstWordMs, 16)} |  ${pct(before.firstWordMs, after.firstWordMs)}`
    );
  }
}

console.log("\nSham Pro — first word (ms): streaming (current) vs a non-streaming baseline, same simulated answer");
console.log("  answer | head | streaming firstWord | non-stream firstWord | saved");
console.log("  -------------------------------------------------------------------------");
for (const [answerMs, headMs] of [[3000, 0], [10000, 0], [30000, 0], [30000, 3400], [90000, 3400]]) {
  const stream = shamReply({ answerMs, headMs, stream: true });
  const base = shamReply({ answerMs, headMs, stream: false });
  console.log(
    `  ${pad(answerMs / 1000 + "s", 6)} | ${pad(headMs, 4)} | ${pad(stream, 19)} | ${pad(base, 20)} |  ${pct(base, stream)}`
  );
}

console.log("\nSham Pro — pre-model database read on a tool-less first step (greeting / plain answer)");
console.log("  before: awaited savedSkillsNote() on every request, even when the step sends no tools");
console.log("  after:  the read is lazy — skipped when the step has no tool block, still one read when tools are sent");
for (const dbMs of [15, 120]) {
  console.log(`  db round-trip ~${dbMs}ms → saved on a greeting: ${dbMs}ms (${pct(3000 + dbMs, 3000)} of a 3s reply)`);
}
