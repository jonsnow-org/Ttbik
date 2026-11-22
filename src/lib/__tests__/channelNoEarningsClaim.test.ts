import { hasEarningsClaim } from "@/lib/channelPublisher";
import { isExcludedPublicPromoProductText } from "@/lib/publicChannelPolicy";
import fs from "node:fs";
import path from "node:path";

describe("the channel's weekly bot promo promises no earnings", () => {
  test("detects earnings and return wording, Arabic and English", () => {
    for (const t of ["يوزّع أرباح المشاهدة", "اربح من الإعلانات", "عوائد مضمونة", "مضاعفة المبلغ", "دخل شهري", "passive income", "profit share", "guaranteed returns"]) expect(hasEarningsClaim(t)).toBe(true);
  });
  test("lets an honest description through", () => {
    expect(hasEarningsClaim("إعلانات تصل إلى مستخدميك، ومهام بسيطة يؤدّونها داخل البوت.")).toBe(false);
  });
  test("the weekly ads-and-earn promo is out of the automatic public rotation (owner approval pending)", () => {
    const src = fs.readFileSync(path.join(__dirname, "../channelPublisher.ts"), "utf8");
    expect(/const intro = "/.test(src)).toBe(false);
    expect(isExcludedPublicPromoProductText("بوت الإعلانات والمهام")).toBe(true);
  });
});
