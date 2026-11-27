import test from "node:test";
import assert from "node:assert/strict";
import { splitInputValues } from "./input-values.mjs";

test("keeps legacy one-field episode input unchanged", () => {
  assert.deepEqual(splitInputValues("963900000000"), ["963900000000"]);
});

test("maps newline-separated values to consecutive form fields", () => {
  assert.deepEqual(splitInputValues("عنوان البطاقة\nالسطر الأول\nالسطر الثاني"), [
    "عنوان البطاقة",
    "السطر الأول",
    "السطر الثاني",
  ]);
});

test("accepts Windows and classic Mac line endings", () => {
  assert.deepEqual(splitInputValues("one\r\ntwo\rthree"), ["one", "two", "three"]);
});

test("does not invent input for an empty script value", () => {
  assert.deepEqual(splitInputValues(""), []);
  assert.deepEqual(splitInputValues(null), []);
});

test("preserves all eleven invoice demo fields in recorder order", () => {
  const values = ["INV-2026-01","2026-11-27","مؤسسة النور الرقمية","الرياض، السعودية | seller@example.com","متجر الندى","جدة، السعودية | buyer@example.com","تصميم متجر إلكتروني","1","1500","15","بيانات تجريبية — الدفع خلال 7 أيام"];
  assert.deepEqual(splitInputValues(values.join("\n")), values);
});

test("preserves the two logo generator fields in recorder order", () => {
  const values = ["مقهى الساحة","قهوة مختصة من قلب المدينة"];
  assert.deepEqual(splitInputValues(values.join("\n")), values);
});
