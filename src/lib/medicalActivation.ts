import { randomInt } from "node:crypto";

export type MedicalFacilityRole = "CLINIC" | "HOSPITAL" | "PHARMACY";

export type MedicalActivationRecord = {
  id: string;
  isRedeemed: boolean;
  role: string;
};

export type MedicalActivationStore = {
  findByCode: (code: string) => Promise<MedicalActivationRecord | null>;
  /** Must atomically mark the code redeemed and assign the user's role. */
  claimAndAssign: (input: {
    id: string;
    redeemedBy: string;
    targetRole: MedicalFacilityRole;
  }) => Promise<boolean>;
};

const ROLE_PREFIX: Record<MedicalFacilityRole, string> = {
  CLINIC: "CLN",
  HOSPITAL: "HOS",
  PHARMACY: "PHR",
};

export function generateMedicalActivationCode(
  role: MedicalFacilityRole,
): string {
  const suffix = Array.from({ length: 6 }, () =>
    randomInt(36).toString(36),
  )
    .join("")
    .toUpperCase();

  return "MED-" + ROLE_PREFIX[role] + "-" + suffix;
}

export async function redeemMedicalActivationCode(
  code: string,
  targetRole: MedicalFacilityRole,
  userId: string,
  store: MedicalActivationStore,
): Promise<boolean> {
  const normalized = code.trim().toUpperCase();
  const found = await store.findByCode(normalized);

  if (!found || found.isRedeemed || found.role !== targetRole) {
    return false;
  }

  return store.claimAndAssign({
    id: found.id,
    redeemedBy: userId,
    targetRole,
  });
}
