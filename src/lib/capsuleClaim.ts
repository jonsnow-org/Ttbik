import { prisma } from "@/lib/prisma";

export type CapsuleClaimResult = "claimed" | "already_claimed" | "taken" | "unavailable";

/**
 * Claim a shared capsule with one conditional database write.
 * Only the first recipient can change recipientId from NULL; concurrent
 * opens cannot both receive the success path or notify the sender twice.
 */
export async function claimFriendCapsule(capsuleId: string, recipientId: string): Promise<CapsuleClaimResult> {
  const updated = await prisma.capsule.updateMany({
    where: {
      id: capsuleId,
      kind: "FRIEND",
      recipientId: null,
      deliveredAt: null,
    },
    data: { recipientId },
  });
  if (updated.count === 1) return "claimed";

  const current = await prisma.capsule.findUnique({
    where: { id: capsuleId },
    select: { recipientId: true, deliveredAt: true },
  });
  if (!current || current.deliveredAt) return "unavailable";
  return current.recipientId === recipientId ? "already_claimed" : "taken";
}
