
export type ZakatPriceInput = {
  goldGrams: number;
  goldPricePerGram: number;
  silverGrams: number;
  silverPricePerGram: number;
  netAssets: number;
  nisabPricePerGram: number;
};

export type ZakatPriceRequirements = {
  needsGoldPrice: boolean;
  needsSilverPrice: boolean;
  needsNisabPrice: boolean;
  needsPrice: boolean;
};

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function zakatPriceRequirements(input: ZakatPriceInput): ZakatPriceRequirements {
  const needsGoldPrice = Number.isFinite(input.goldGrams) && input.goldGrams > 0
    && !isPositiveFinite(input.goldPricePerGram);
  const needsSilverPrice = Number.isFinite(input.silverGrams) && input.silverGrams > 0
    && !isPositiveFinite(input.silverPricePerGram);
  const needsNisabPrice = Number.isFinite(input.netAssets) && input.netAssets > 0
    && !isPositiveFinite(input.nisabPricePerGram);

  return {
    needsGoldPrice,
    needsSilverPrice,
    needsNisabPrice,
    needsPrice: needsGoldPrice || needsSilverPrice || needsNisabPrice,
  };
}

export function zakatMissingPricesMessage(
  requirements: ZakatPriceRequirements,
  useGoldNisab: boolean,
): string {
  const missing: string[] = [];
  if (requirements.needsGoldPrice) missing.push("سعر جرام الذهب");
  if (requirements.needsSilverPrice) missing.push("سعر جرام الفضة");

  const selectedPriceAlreadyNamed = useGoldNisab
    ? requirements.needsGoldPrice
    : requirements.needsSilverPrice;
  if (requirements.needsNisabPrice && !selectedPriceAlreadyNamed) {
    missing.push(`سعر جرام ${useGoldNisab ? "الذهب" : "الفضة"} لحساب النصاب`);
  }

  return missing.length
    ? `أدخل ${missing.join(" و")} قبل حساب الزكاة بدقة.`
    : "بيانات الأسعار غير مكتملة لحساب الزكاة بدقة.";
}
