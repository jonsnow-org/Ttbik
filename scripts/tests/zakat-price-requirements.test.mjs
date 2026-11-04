
import test from "node:test";
import assert from "node:assert/strict";
import { zakatPriceRequirements, zakatMissingPricesMessage } from "../../src/lib/zakatPriceRequirements.ts";

test("cash-only assets need the selected nisab price before a yes/no answer", () => {
  const result = zakatPriceRequirements({
    goldGrams: 0, goldPricePerGram: 0,
    silverGrams: 0, silverPricePerGram: 0,
    netAssets: 1000, nisabPricePerGram: 0,
  });
  assert.equal(result.needsNisabPrice, true);
  assert.equal(result.needsPrice, true);
  assert.match(zakatMissingPricesMessage(result, true), /الذهب/);
});

test("unpriced gold is flagged even when silver is selected as the nisab metal", () => {
  const result = zakatPriceRequirements({
    goldGrams: 10, goldPricePerGram: 0,
    silverGrams: 0, silverPricePerGram: 2,
    netAssets: 0, nisabPricePerGram: 2,
  });
  assert.equal(result.needsGoldPrice, true);
  assert.equal(result.needsPrice, true);
  assert.match(zakatMissingPricesMessage(result, false), /الذهب/);
});

test("unpriced silver is flagged even when gold is selected as the nisab metal", () => {
  const result = zakatPriceRequirements({
    goldGrams: 0, goldPricePerGram: 100,
    silverGrams: 20, silverPricePerGram: 0,
    netAssets: 0, nisabPricePerGram: 100,
  });
  assert.equal(result.needsSilverPrice, true);
  assert.equal(result.needsPrice, true);
  assert.match(zakatMissingPricesMessage(result, true), /الفضة/);
});

test("complete prices allow the normal calculation path", () => {
  const result = zakatPriceRequirements({
    goldGrams: 10, goldPricePerGram: 100,
    silverGrams: 20, silverPricePerGram: 2,
    netAssets: 1000, nisabPricePerGram: 100,
  });
  assert.equal(result.needsPrice, false);
});
