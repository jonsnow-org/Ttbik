import test from "node:test";
import assert from "node:assert/strict";
import { sweepAmount } from "./sweep.mjs";
const G = (x) => BigInt(Math.round(x * 1e9));
const base = { reserve: G(0.9), min: G(0.3), pendingClaims: 0, unfinishedMints: 0 };

test("nothing moves while the balance is at or below the reserve plus the minimum", () => {
  assert.equal(sweepAmount({ ...base, balance: G(0.084) }), 0n);
  assert.equal(sweepAmount({ ...base, balance: G(0.9) }), 0n);
  assert.equal(sweepAmount({ ...base, balance: G(1.19) }), 0n);
});
test("only the surplus above the reserve is sent", () => {
  assert.equal(sweepAmount({ ...base, balance: G(1.2) }), G(0.3));
  assert.equal(sweepAmount({ ...base, balance: G(5) }), G(4.1));
});
test("nothing is sent while a claim or a mint is still unfinished (its refund or mint needs the balance)", () => {
  assert.equal(sweepAmount({ ...base, balance: G(5), pendingClaims: 1 }), 0n);
  assert.equal(sweepAmount({ ...base, balance: G(5), unfinishedMints: 1 }), 0n);
});
