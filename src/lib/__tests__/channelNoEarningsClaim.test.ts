import { hasEarningsClaim } from "@/lib/channelPublisher";
import fs from "node:fs";
import path from "node:path";

describe("the channel's weekly bot promo promises no earnings", () => {
  test("detects earnings and return wording, Arabic and English", () => {
    for (const t of ["يوزّع أرباح المشاهدة", "اربح من الإعلانات", "عوائد مضمونة", "مضاعفة المبلغ", "دخل شهري", "passive income", "profit share", "guaranteed returns"]) expect(hasEarningsClaim(t)).toBe(true);
  });
  test("lets an honest description through", () => {
    expect(hasEarningsClaim("إعلانات تصل إلى مستخدميك، ومهام بسيطة يؤدّونها داخل البوت.")).toBe(false);
  });
  test("the fixed intro text in the publisher has no earnings wording", () => {
    const src = fs.readFileSync(path.join(__dirname, "../channelPublisher.ts"), "utf8");
    const intro = /const intro = "([^"]+)"/.exec(src)![1];
    expect(hasEarningsClaim(intro)).toBe(false);
  });
});
