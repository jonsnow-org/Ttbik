import test from "node:test";
import assert from "node:assert/strict";
import {
  generateMedicalActivationCode,
  redeemMedicalActivationCode,
} from "../../src/lib/medicalActivation.ts";

test("preserves all three existing activation-code formats", () => {
  for (const [role, prefix] of [
    ["CLINIC", "CLN"],
    ["HOSPITAL", "HOS"],
    ["PHARMACY", "PHR"],
  ]) {
    const code = generateMedicalActivationCode(role);
    assert.match(code, new RegExp("^MED-" + prefix + "-[A-Z0-9]{6}$"));
  }
});

test("does not claim a missing, redeemed or wrong-role code", async () => {
  let claims = 0;
  const store = {
    findByCode: async (code) => {
      if (code === "MED-MISSING") return null;
      if (code === "MED-USED") return { id: "1", isRedeemed: true, role: "CLINIC" };
      return { id: "2", isRedeemed: false, role: "HOSPITAL" };
    },
    claimAndAssign: async () => {
      claims++;
      return true;
    },
  };

  assert.equal(await redeemMedicalActivationCode("MED-MISSING", "CLINIC", "10", store), false);
  assert.equal(await redeemMedicalActivationCode("MED-USED", "CLINIC", "10", store), false);
  assert.equal(await redeemMedicalActivationCode("MED-ROLE", "CLINIC", "10", store), false);
  assert.equal(claims, 0);
});

test("only one concurrent user can claim the same activation code", async () => {
  let claimed = false;
  const store = {
    findByCode: async () => ({ id: "code-1", isRedeemed: false, role: "CLINIC" }),
    claimAndAssign: async () => {
      await Promise.resolve();
      if (claimed) return false;
      claimed = true;
      return true;
    },
  };

  const results = await Promise.all([
    redeemMedicalActivationCode(" med-cln-abcdef ", "CLINIC", "1001", store),
    redeemMedicalActivationCode("MED-CLN-ABCDEF", "CLINIC", "1002", store),
  ]);

  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(claimed, true);
});
