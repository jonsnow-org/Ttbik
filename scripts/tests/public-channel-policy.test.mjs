import test from "node:test";
import assert from "node:assert/strict";
import {
  EXCLUDED_PUBLIC_BOT_SLUGS,
  ensureEnglishFirst,
  hasArabicScript,
  hasEarningsClaim,
  isEnglishOnlyPublicText,
  isExcludedPublicPromoProductText,
} from "../../src/lib/publicChannelPolicy.ts";

test("public promo rotation explicitly excludes owner-review products", () => {
  assert.equal(EXCLUDED_PUBLIC_BOT_SLUGS.has("ads-and-earn"), true);
  assert.equal(EXCLUDED_PUBLIC_BOT_SLUGS.has("medical"), true);
  assert.equal(EXCLUDED_PUBLIC_BOT_SLUGS.has("media-downloader"), false);
  assert.equal(isExcludedPublicPromoProductText("بوت الإعلان والمهام"), true);
  assert.equal(isExcludedPublicPromoProductText("البوت الطبي"), true);
});

test("earnings policy blocks promises but allows risk disclaimers and neutral descriptions", () => {
  assert.equal(hasEarningsClaim("يوزع أرباح المشاهدة تلقائياً"), true);
  assert.equal(hasEarningsClaim("اربح المال كل يوم"), true);
  assert.equal(hasEarningsClaim("Guaranteed returns every week"), true);
  assert.equal(hasEarningsClaim("Get paid to watch ads"), true);
  assert.equal(hasEarningsClaim("Earn from viewing videos"), true);
  assert.equal(hasEarningsClaim("اكسب من مشاهدة الإعلانات"), true);
  assert.equal(hasEarningsClaim("No promise of any return; crypto is risky."), false);
  assert.equal(hasEarningsClaim("The board shows ranks only, not profit."), false);
  assert.equal(hasEarningsClaim("Creators can see recorded earnings from launched coins."), false);
});

test("coin-channel copy rejects any Arabic script in every public field", () => {
  assert.equal(isEnglishOnlyPublicText("How to buy ZNB", "Check the contract first.", "https://example.com"), true);
  assert.equal(isEnglishOnlyPublicText("How to buy ZNB", "تحقق من العقد أولاً"), false);
  assert.equal(hasArabicScript("Zenobia"), false);
});

test("general-channel messages receive an English first line without rewriting bilingual messages", () => {
  assert.equal(ensureEnglishFirst("خبر بالعربية"), "Sham AI update\n\nخبر بالعربية");
  assert.equal(ensureEnglishFirst("<b>Tool update</b>\nأداة جديدة"), "<b>Tool update</b>\nأداة جديدة");
  assert.equal(ensureEnglishFirst(""), "");
});
