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
