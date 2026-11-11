export type TelegramAssetType = "CHANNEL" | "GROUP" | "BOT";

export type AssetIdentityInput = {
  id: string;
  firstName: string;
  lastName?: string | null;
  username?: string | null;
  phoneNumber?: string | null;
  phoneVerified?: boolean;
};

export type AssetIdentitySnapshot = {
  telegramId: string;
  firstName: string;
  lastName: string | null;
  username: string;
  phoneNumber: string;
  phoneVerified: true;
};

export const ASSET_MARKET_COMMISSION_RATE = 0;

export function normalizeAssetIdentifier(type: TelegramAssetType, input: unknown): string | null {
  let value = String(input ?? "").trim();
  if (type === "CHANNEL" || type === "GROUP") {
    value = value.replace(/^https?:\/\//i, "").replace(/^(www\.)?(t|telegram)\.me\//i, "").replace(/^s\//i, "").replace(/^@/, "");
    value = value.split(/[/?#\s]/)[0] || "";
    if (/^-100\d{5,20}$/.test(value) || /^-\d{5,20}$/.test(value)) return value;
  } else {
    value = value.replace(/^https?:\/\//i, "").replace(/^(www\.)?(t|telegram)\.me\//i, "").replace(/^@/, "");
    value = value.split(/[/?#\s]/)[0] || "";
  }
  return /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(value) ? value : null;
}

export function normalizeAssetPhone(input: unknown): string | null {
  const value = String(input ?? "").trim().replace(/[\s().-]/g, "");
  if (!/^\+?[1-9]\d{6,14}$/.test(value)) return null;
  return value.startsWith("+") ? value : `+${value}`;
}

export function assetIdentityProblem(input: AssetIdentityInput): string | null {
  if (!/^\d{5,20}$/.test(String(input.id || ""))) return "معرّف تيليجرام الرقمي غير صالح.";
  if (!String(input.firstName || "").trim()) return "اسم الحساب غير مكتمل. حدّث اسمك في تيليجرام ثم أعد المحاولة.";
  if (!/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(String(input.username || ""))) return "يجب تعيين Username عام في تيليجرام قبل البيع أو الشراء.";
  if (!input.phoneVerified || !normalizeAssetPhone(input.phoneNumber)) return "يجب توثيق رقم هاتفك بمشاركته من زر تيليجرام الرسمي أولاً.";
  return null;
}

export function assetIdentitySnapshot(input: AssetIdentityInput): AssetIdentitySnapshot | null {
  if (assetIdentityProblem(input)) return null;
  return {
    telegramId: input.id,
    firstName: String(input.firstName).trim().slice(0, 64),
    lastName: String(input.lastName || "").trim().slice(0, 64) || null,
    username: String(input.username).replace(/^@/, "").trim(),
    phoneNumber: normalizeAssetPhone(input.phoneNumber)!,
    phoneVerified: true,
  };
}

export function splitAssetSale(price: number) {
  const total = Math.round(price * 100) / 100;
  const commission = Math.round(total * ASSET_MARKET_COMMISSION_RATE * 100) / 100;
  return { price: total, commission, payout: Math.round((total - commission) * 100) / 100 };
}

export function makeAssetSaleCode(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let tail = "";
  for (let i = 0; i < 8; i++) tail += alphabet[bytes[i] % alphabet.length];
  return `CHM-${tail}`;
}
